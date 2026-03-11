import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAgentStore, deriveContextKey, getSessionState, type AgentStatusType, type UsageData } from "../stores/agent-store";
import { useProjectStore } from "../stores/project-store";
import * as tauri from "../lib/tauri";

// All agent events are wrapped in ScopedAgentEvent { context_key, ...event }
// The context_key field is present at the top level of every payload.

interface ScopedPayload {
  context_key: string;
}

interface ContentDeltaPayload extends ScopedPayload {
  type: "content-delta";
  text: string;
}

interface ContentCompletePayload extends ScopedPayload {
  type: "content-complete";
  full_text: string;
}

interface MessageStartPayload extends ScopedPayload {
  type: "message-start";
  session_id: string;
}

interface MessageEndPayload extends ScopedPayload {
  type: "message-end";
  session_id: string;
  result_text: string;
  usage?: UsageData;
}

interface ErrorPayload extends ScopedPayload {
  type: "error";
  message: string;
}

interface StatusChangePayload extends ScopedPayload {
  type: "status-change";
  status: string;
}

interface ToolUsePayload extends ScopedPayload {
  type: "tool-use";
  tool_name: string;
  tool_input: unknown;
}

interface TextBlockStartPayload extends ScopedPayload {
  type: "text-block-start";
  index: number;
}

// Approval events come from the shared ApprovalServer, not ScopedAgentEvent.
// They have featureId but no context_key — we derive it.
interface ApprovalRequestPayload {
  requestId: string;
  toolName: string;
  phase: string;
  artifactType: string;
  title: string;
  preview: unknown;
  action: string;
  existing?: unknown;
  featureId?: string;
}

interface UserQuestionPayload extends ScopedPayload {
  type: "user-question";
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

/** Derive a context key for an approval request that lacks one. */
function approvalContextKey(featureId?: string): string {
  if (featureId) return `feature:${featureId}`;
  // Fall back to current view for app-level agents
  const project = useProjectStore.getState().project;
  if (!project) return "app:overview";
  const view = project.currentView;
  if (view.type === "feature") return `feature:${view.featureId}`;
  return `app:${view.view}`;
}

/** Resolve a context key to a human-readable label. */
function contextLabel(contextKey: string): string {
  const project = useProjectStore.getState().project;
  if (contextKey.startsWith("feature:")) {
    const featureId = contextKey.slice("feature:".length);
    const feature = project?.features.find((f) => f.id === featureId);
    return feature?.name ?? "Feature";
  }
  if (contextKey.startsWith("app:")) {
    const view = contextKey.slice("app:".length);
    const labels: Record<string, string> = {
      overview: "Overview",
      architect: "Architecture",
      "design-system": "Design System",
      build: "Build",
      project: "Project",
    };
    return labels[view] ?? view;
  }
  return contextKey;
}

/** Get the currently active context key. */
function getActiveContextKey(): string {
  return deriveContextKey(useProjectStore.getState().project);
}

/** Send an OS notification if the window is not focused. Lazy-loads the plugin to avoid module-level failures. */
async function notifyOS(title: string, body: string) {
  if (document.hasFocus()) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Notification not available (e.g. CI, unsupported platform)
  }
}

export function useAgentEvents() {
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [];
    const store = useAgentStore.getState;

    unlisteners.push(
      listen<MessageStartPayload>("agent:message-start", (event) => {
        const key = event.payload.context_key;
        store().setSessionId(key, event.payload.session_id);
        store().setStatus(key, "thinking");
      }),
    );

    unlisteners.push(
      listen<TextBlockStartPayload>("agent:text-block-start", (event) => {
        store().startTextBlock(event.payload.context_key);
      }),
    );

    unlisteners.push(
      listen<ContentDeltaPayload>("agent:content-delta", (event) => {
        store().appendDelta(event.payload.context_key, event.payload.text);
      }),
    );

    unlisteners.push(
      listen<ContentCompletePayload>("agent:content-complete", (event) => {
        store().completeMessage(event.payload.context_key, event.payload.full_text);
      }),
    );

    unlisteners.push(
      listen<MessageEndPayload>("agent:message-end", async (event) => {
        const key = event.payload.context_key;
        console.log("[sensable] message-end payload:", JSON.stringify(event.payload, null, 2));

        store().setSessionId(key, event.payload.session_id);
        store().endMessage(key);
        store().setStatus(key, "running");

        // Track context window usage
        if (event.payload.usage) {
          store().setUsage(key, event.payload.usage);
        }

        // Re-read project from disk to pick up any changes (e.g. advance_onboarding, new artifacts)
        const projectPath = useProjectStore.getState().projectPath;
        if (projectPath) {
          try {
            const project = await tauri.openProject(projectPath);
            useProjectStore.setState({ project });
          } catch (e) {
            console.error("Failed to re-read project:", e);
          }
        }

        // Check if a phase transition was approved during this turn.
        // By now project.json is guaranteed written by the MCP server.
        const session = getSessionState(store().sessions, key);
        if (session.needsPhaseRestart) {
          await store().handlePhaseTransition(key);
          useProjectStore.getState().bumpFileWriteVersion();
          return; // Skip notification — session is being torn down
        }

        // Notify if this is a background context (not currently active)
        const activeKey = getActiveContextKey();
        if (key !== activeKey) {
          const label = contextLabel(key);
          store().markUnread(key);
          toast.info(`${label} is waiting for input`, {
            duration: 5000,
            position: "bottom-right",
          });
          notifyOS("Sensable", `${label} is waiting for input`);
        }
      }),
    );

    unlisteners.push(
      listen<ErrorPayload>("agent:error", async (event) => {
        const key = event.payload.context_key;
        store().setError(key, event.payload.message);
        store().endMessage(key);
        store().setStatus(key, "error");

        // If a phase transition was pending, still handle it
        const session = getSessionState(store().sessions, key);
        if (session.needsPhaseRestart) {
          await store().handlePhaseTransition(key);
          const projectPath = useProjectStore.getState().projectPath;
          if (projectPath) {
            try {
              const project = await tauri.openProject(projectPath);
              useProjectStore.setState({ project });
            } catch (e) {
              console.error("Failed to re-read project after error:", e);
            }
          }
          useProjectStore.getState().bumpFileWriteVersion();
        }
      }),
    );

    unlisteners.push(
      listen<StatusChangePayload>("agent:status-change", (event) => {
        const statusMap: Record<string, AgentStatusType> = {
          starting: "starting",
          running: "running",
          thinking: "thinking",
          stopped: "offline",
          error: "error",
        };
        const mapped = statusMap[event.payload.status] ?? "offline";
        store().setStatus(event.payload.context_key, mapped);
      }),
    );

    unlisteners.push(
      listen<ToolUsePayload>("agent:tool-use", (event) => {
        store().addToolCall(event.payload.context_key, event.payload.tool_name, event.payload.tool_input);
      }),
    );

    unlisteners.push(
      listen<ApprovalRequestPayload>("agent:approval-request", async (event) => {
        const p = event.payload;
        const contextKey = approvalContextKey(p.featureId);
        const { autoAcceptRules, respondToApproval } = store();

        // Never auto-accept execute_command or submit_plan for safety
        const isCommand = p.toolName.includes("execute_command");
        const isPlan = p.toolName === "submit_plan";
        if (!isCommand && !isPlan && autoAcceptRules.has(p.toolName)) {
          await respondToApproval(p.requestId, true, undefined, p.toolName);
          return;
        }

        store().addPendingApproval({
          contextKey,
          requestId: p.requestId,
          toolName: p.toolName,
          phase: p.phase,
          artifactType: p.artifactType,
          title: p.title,
          preview: p.preview,
          action: p.action as "create" | "update" | "delete" | "transition" | "plan",
          existing: p.existing,
        });

        // OS notification for background context approvals
        const activeKey = getActiveContextKey();
        if (contextKey !== activeKey) {
          const label = contextLabel(contextKey);
          notifyOS("Sensable — Approval Needed", `${label}: ${p.title}`);
        }
      }),
    );

    unlisteners.push(
      listen<UserQuestionPayload>("agent:user-question", (event) => {
        store().setPendingQuestion(event.payload.context_key, {
          questions: event.payload.questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options,
            multiSelect: q.multiSelect,
          })),
        });
      }),
    );

    return () => {
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);
}
