import { create } from "zustand";
import type { Project } from "@sensable/schemas";
import * as tauri from "../lib/tauri";
import { useProjectStore } from "./project-store";

export interface MessageImage {
  base64: string;
  mediaType: string;
}

export interface ContentBlock {
  type: "text" | "tool-call";
  content: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface ElementReference {
  tag: string;
  selector: string;
  outerHTML: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks: ContentBlock[];
  timestamp: number;
  isStreaming?: boolean;
  toolCalls?: { name: string; input: unknown }[];
  images?: MessageImage[];
  elementRef?: ElementReference;
}

export interface PendingApproval {
  contextKey: string;
  featureName?: string;
  requestId: string;
  toolName: string;
  phase: string;
  artifactType: string;
  title: string;
  preview: unknown;
  action: "create" | "update" | "delete" | "transition" | "plan";
  existing?: unknown;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface PendingUserQuestion {
  questions: UserQuestion[];
}

export type AgentStatusType = "offline" | "starting" | "running" | "thinking" | "error";

/** Token usage data from a Claude CLI result event. */
export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  numTurns?: number;
  totalCostUsd?: number;
}

/** Per-agent session state, keyed by context key. */
export interface AgentSessionState {
  messages: AgentMessage[];
  isStreaming: boolean;
  status: AgentStatusType;
  sessionId: string | null;
  error: string | null;
  pendingQuestion: PendingUserQuestion | null;
  /** Latest usage data — updated after each agent turn. */
  usage: UsageData | null;
  /** Set when transition_phase is approved; cleared by message-end handler to trigger session restart. */
  needsPhaseRestart: boolean;
}

const defaultSessionState: AgentSessionState = {
  messages: [],
  isStreaming: false,
  status: "offline",
  sessionId: null,
  error: null,
  pendingQuestion: null,
  usage: null,
  needsPhaseRestart: false,
};

/** Derive a context key from the current project state. */
export function deriveContextKey(project: Project | null): string {
  if (!project) return "app:overview";
  if (project.onboarding?.status && project.onboarding.status !== "complete") {
    return `app:onboarding-${project.onboarding.status}`;
  }
  const view = project.currentView;
  if (view.type === "feature") return `feature:${view.featureId}:${view.phase}`;
  // Design system: per-item sessions when focused on a specific layout/component
  if (view.type === "app" && view.view === "design-system") {
    const focus = useProjectStore.getState().designSystemFocus;
    if (focus) return `app:design-system:${focus.type}:${focus.itemId}`;
  }
  return `app:${view.view}`;
}

/** Extract the feature ID from a context key like "feature:{id}:{phase}". */
export function featureIdFromContextKey(contextKey: string): string | null {
  if (!contextKey.startsWith("feature:")) return null;
  const parts = contextKey.split(":");
  return parts[1] ?? null;
}

/** Extract the phase from a context key like "feature:{id}:{phase}". */
export function phaseFromContextKey(contextKey: string): string | null {
  if (!contextKey.startsWith("feature:")) return null;
  const parts = contextKey.split(":");
  return parts[2] ?? null;
}

/** Get a session from the store, returning defaults for unknown keys. */
export function getSessionState(
  sessions: Record<string, AgentSessionState>,
  contextKey: string,
): AgentSessionState {
  return sessions[contextKey] ?? defaultSessionState;
}

// --- Internal helpers ---

function updateSession(
  state: { sessions: Record<string, AgentSessionState> },
  contextKey: string,
  updater: (session: AgentSessionState) => Partial<AgentSessionState>,
): { sessions: Record<string, AgentSessionState> } {
  const session = state.sessions[contextKey] ?? defaultSessionState;
  return {
    sessions: {
      ...state.sessions,
      [contextKey]: { ...session, ...updater(session) },
    },
  };
}

const phaseLabels: Record<string, string> = {
  discover: "Discover",
  define: "Define",
  develop: "Develop (Wireframes & Prototypes)",
  deliver: "Deliver",
};

/**
 * Build a context prefix for the first message in a feature agent session.
 * This reinforces the system prompt so the agent knows exactly what mode it's in.
 */
function buildPhaseContext(contextKey: string): string | null {
  const fid = featureIdFromContextKey(contextKey);
  const phase = phaseFromContextKey(contextKey);
  if (!fid || !phase) return null;

  const project = useProjectStore.getState().project;
  if (!project) return null;

  const feature = project.features.find((f) => f.id === fid);
  if (!feature) return null;

  const label = phaseLabels[phase] ?? phase;

  let subStepHint = "";
  if (phase === "develop") {
    const subStep = useProjectStore.getState().developSubStep;
    subStepHint = subStep === "prototype"
      ? " You are in PROTOTYPE sub-step — the user has chosen a wireframe and wants you to build an interactive prototype."
      : " You are in WIREFRAME sub-step — generate wireframe layout options for the user to choose from.";
  }

  return (
    `[Context: You are working on the feature "${feature.name}" in ${label} mode.${subStepHint} ` +
    `All file operations MUST go through MCP tools (create_artifact, update_artifact, save_wireframe, save_prototype, etc.). ` +
    `Work within the .sensable project folder — do NOT directly edit the user's source code files unless in Deliver mode.]\n\n`
  );
}

/**
 * Build a context prefix for the first message in an app-level agent session.
 * Covers views like design-system, architect, project, etc.
 */
function buildAppContext(contextKey: string): string | null {
  if (!contextKey.startsWith("app:")) return null;

  // Per-item design system sessions: app:design-system:{type}:{itemId}
  const dsMatch = contextKey.match(/^app:design-system:(layouts|components):(.+)$/);
  if (dsMatch) {
    const [, itemType, itemId] = dsMatch;
    const project = useProjectStore.getState().project;
    const ds = project?.designSystem;
    const items = itemType === "layouts" ? ds?.layouts : ds?.components;
    const item = items?.find((i: { id: string }) => i.id === itemId);
    const itemName = item?.name ?? itemId;
    const singular = itemType === "layouts" ? "LAYOUT" : "COMPONENT";

    return (
      `[Context: You are working on the design system ${singular} "${itemName}". ` +
      `All file operations MUST go through MCP tools (create_artifact, update_artifact, write_project_file, etc.). ` +
      `Work within the .sensable project folder — do NOT directly edit the user's source code files.]\n\n`
    );
  }

  const view = contextKey.slice(4);

  const hints: Record<string, string> = {
    "design-system":
      "[Context: You are working on the DESIGN SYSTEM. " +
      "Define colors, typography, spacing, border radius, and component styles. " +
      "All file operations MUST go through MCP tools (create_artifact, update_artifact, write_project_file, etc.). " +
      "Work within the .sensable project folder — do NOT directly edit the user's source code files.]\n\n",
    architect:
      "[Context: You are working on the ARCHITECTURE view. " +
      "Help plan system architecture — data models, API design, routing, and component structure. " +
      "All file operations MUST go through MCP tools.]\n\n",
    project:
      "[Context: You are working on the PROJECT SPEC. " +
      "Help refine the project's high-level spec — what it is, who it's for, and what it aims to achieve. " +
      "All file operations MUST go through MCP tools.]\n\n",
    overview:
      "[Context: You are in the OVERVIEW view. " +
      "Help the user describe their product idea and break it down into features. " +
      "All file operations MUST go through MCP tools.]\n\n",
  };

  return hints[view] ?? null;
}

/**
 * Build a short sub-step context for messages within an already-running develop session.
 * Only returns a prefix when the phase is "develop" — for other phases, returns null.
 */
function buildDevelopSubStepContext(contextKey: string): string | null {
  const phase = phaseFromContextKey(contextKey);
  if (phase !== "develop") return null;

  const subStep = useProjectStore.getState().developSubStep;
  if (subStep === "prototype") {
    return "[Context: You are in PROTOTYPE mode. Build an interactive prototype from the chosen wireframe and design system.]\n\n";
  }
  return "[Context: You are in WIREFRAME mode. Generate wireframe layout options for the user to choose from.]\n\n";
}

interface AgentState {
  sessions: Record<string, AgentSessionState>;
  pendingApprovals: PendingApproval[];
  autoAcceptRules: Set<string>;
  unreadContextKeys: Set<string>;

  // Session actions — all take contextKey as first param
  sendMessage: (contextKey: string, projectPath: string, content: string, images?: MessageImage[]) => Promise<void>;
  stopAgent: (contextKey: string) => Promise<void>;
  appendDelta: (contextKey: string, text: string) => void;
  startTextBlock: (contextKey: string) => void;
  completeMessage: (contextKey: string, fullText: string) => void;
  setSessionId: (contextKey: string, id: string) => void;
  setStatus: (contextKey: string, status: AgentStatusType) => void;
  setError: (contextKey: string, error: string | null) => void;
  addToolCall: (contextKey: string, name: string, input: unknown) => void;
  endMessage: (contextKey: string) => void;
  setUsage: (contextKey: string, usage: UsageData) => void;
  clearMessages: (contextKey: string) => void;
  resetSession: (contextKey: string) => Promise<void>;
  resetAll: () => Promise<void>;

  // Approval actions
  addPendingApproval: (approval: PendingApproval) => void;
  removePendingApproval: (requestId: string) => void;
  respondToApproval: (requestId: string, approved: boolean, reason?: string, toolName?: string) => Promise<void>;

  // Question actions
  setPendingQuestion: (contextKey: string, question: PendingUserQuestion | null) => void;
  answerQuestion: (contextKey: string, projectPath: string, answer: string) => Promise<void>;

  // Auto-accept
  addAutoAcceptRule: (toolName: string) => void;
  clearAutoAcceptRules: () => void;

  // Phase transition
  markNeedsPhaseRestart: (contextKey: string) => void;
  handlePhaseTransition: (contextKey: string) => Promise<void>;

  // Unread tracking
  markUnread: (contextKey: string) => void;
  markRead: (contextKey: string) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: {},
  pendingApprovals: [],
  autoAcceptRules: new Set<string>(),
  unreadContextKeys: new Set<string>(),

  sendMessage: async (contextKey, projectPath, content, images) => {
    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      blocks: [],
      timestamp: Date.now(),
      images: images?.map((img) => ({ base64: img.base64, mediaType: img.mediaType })),
    };

    const assistantMsg: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      blocks: [],
      timestamp: Date.now(),
      isStreaming: true,
    };

    set((s) =>
      updateSession(s, contextKey, (session) => ({
        messages: [...session.messages, userMsg, assistantMsg],
        isStreaming: true,
        error: null,
      })),
    );

    const tauriImages = images?.map((img) => ({
      base64: img.base64,
      media_type: img.mediaType,
    }));

    try {
      const session = getSessionState(get().sessions, contextKey);
      if (session.status === "running") {
        // For ongoing develop sessions, prepend sub-step context so the agent knows wireframe vs prototype
        const subStepContext = buildDevelopSubStepContext(contextKey);
        const messageForRunning = subStepContext ? subStepContext + content : content;
        await tauri.sendAgentMessage(contextKey, messageForRunning, tauriImages);
      } else {
        // For new sessions, prepend context to orient the agent (feature or app-level)
        const phaseContext = buildPhaseContext(contextKey) ?? buildAppContext(contextKey);
        const messageForAgent = phaseContext ? phaseContext + content : content;
        await tauri.startAgent(projectPath, contextKey, messageForAgent, tauriImages);
      }
    } catch (e) {
      set((s) =>
        updateSession(s, contextKey, (session) => ({
          isStreaming: false,
          error: String(e),
          status: "error",
          messages: session.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `Error: ${e}`, blocks: [{ type: "text" as const, content: `Error: ${e}` }], isStreaming: false }
              : m,
          ),
        })),
      );
    }
  },

  stopAgent: async (contextKey) => {
    try {
      await tauri.stopAgent(contextKey);
    } catch (e) {
      console.error("Failed to stop agent:", e);
    }
  },

  startTextBlock: (contextKey) => {
    set((s) =>
      updateSession(s, contextKey, (session) => {
        const messages = [...session.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.isStreaming) {
          const blocks = [...last.blocks];
          const lastBlock = blocks[blocks.length - 1];
          if (!lastBlock || lastBlock.type === "tool-call" || lastBlock.content.length > 0) {
            blocks.push({ type: "text", content: "" });
          }
          messages[messages.length - 1] = { ...last, blocks };
        }
        return { messages };
      }),
    );
  },

  appendDelta: (contextKey, text) => {
    set((s) =>
      updateSession(s, contextKey, (session) => {
        const messages = [...session.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.isStreaming) {
          const blocks = [...last.blocks];
          const lastBlock = blocks[blocks.length - 1];
          if (!lastBlock || lastBlock.type !== "text") {
            blocks.push({ type: "text", content: text });
          } else {
            blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + text };
          }
          messages[messages.length - 1] = {
            ...last,
            content: last.content + text,
            blocks,
          };
        }
        return { messages };
      }),
    );
  },

  completeMessage: (contextKey, fullText) => {
    set((s) =>
      updateSession(s, contextKey, (session) => {
        const messages = [...session.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.isStreaming) {
          messages[messages.length - 1] = {
            ...last,
            content: fullText,
            isStreaming: false,
          };
        }
        return { messages, isStreaming: false };
      }),
    );
  },

  endMessage: (contextKey) => {
    set((s) =>
      updateSession(s, contextKey, (session) => {
        const messages = [...session.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.isStreaming) {
          messages[messages.length - 1] = {
            ...last,
            isStreaming: false,
          };
        }
        return { messages, isStreaming: false };
      }),
    );
  },

  setUsage: (contextKey, usage) => {
    set((s) => updateSession(s, contextKey, () => ({ usage })));
  },

  setSessionId: (contextKey, id) => {
    set((s) => updateSession(s, contextKey, () => ({ sessionId: id })));
  },

  setStatus: (contextKey, status) => {
    set((s) => updateSession(s, contextKey, () => ({ status })));
  },

  setError: (contextKey, error) => {
    set((s) => updateSession(s, contextKey, () => ({ error })));
  },

  addToolCall: (contextKey, name, input) => {
    set((s) =>
      updateSession(s, contextKey, (session) => {
        const messages = [...session.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant") {
          const toolCalls = [...(last.toolCalls ?? []), { name, input }];
          const blocks = [...last.blocks, { type: "tool-call" as const, content: "", toolName: name, toolInput: input }];
          messages[messages.length - 1] = { ...last, toolCalls, blocks };
        }
        return { messages };
      }),
    );
  },

  clearMessages: (contextKey) => {
    set((s) => updateSession(s, contextKey, () => ({ messages: [], error: null })));
  },

  resetSession: async (contextKey) => {
    const session = getSessionState(get().sessions, contextKey);
    if (session.status !== "offline") {
      try {
        await tauri.stopAgent(contextKey);
      } catch {
        // Process may already be gone
      }
    }
    set((s) => {
      const { [contextKey]: _, ...rest } = s.sessions;
      return {
        sessions: rest,
        // Also remove any pending approvals for this session
        pendingApprovals: s.pendingApprovals.filter((a) => a.contextKey !== contextKey),
      };
    });
  },

  resetAll: async () => {
    try {
      await tauri.stopAllAgents();
    } catch {
      // Agents may already be gone
    }
    set({
      sessions: {},
      pendingApprovals: [],
      autoAcceptRules: new Set(),
      unreadContextKeys: new Set(),
    });
  },

  markNeedsPhaseRestart: (contextKey) => {
    set((s) => updateSession(s, contextKey, () => ({ needsPhaseRestart: true })));
  },

  handlePhaseTransition: async (contextKey) => {
    // Stop the agent process and clear session ID so next start gets a fresh session
    try {
      await tauri.resetAgentSession(contextKey);
    } catch (e) {
      console.error("Failed to reset agent session:", e);
      // Fall back to regular stop
      try {
        await tauri.stopAgent(contextKey);
      } catch {
        // Process may already be gone
      }
    }
    // Reset frontend state for this context
    set((s) => {
      const { [contextKey]: _, ...rest } = s.sessions;
      return {
        sessions: rest,
        pendingApprovals: s.pendingApprovals.filter((a) => a.contextKey !== contextKey),
      };
    });
  },

  addPendingApproval: (approval) => {
    set((s) => ({ pendingApprovals: [...s.pendingApprovals, approval] }));
  },

  removePendingApproval: (requestId) => {
    set((s) => ({
      pendingApprovals: s.pendingApprovals.filter((a) => a.requestId !== requestId),
    }));
  },

  respondToApproval: async (requestId, approved, reason, fallbackToolName) => {
    const pending = get().pendingApprovals.find((a) => a.requestId === requestId);
    const effectiveToolName = pending?.toolName ?? fallbackToolName;
    try {
      await tauri.respondToApproval(requestId, approved, reason);
    } catch (e) {
      console.error("Failed to respond to approval:", e);
    }
    if (approved && effectiveToolName) {
      const { useProjectStore } = await import("./project-store");
      if (effectiveToolName.includes("write_project_file")) {
        useProjectStore.getState().bumpFileWriteVersion();
      }
      if (effectiveToolName === "transition_phase") {
        // Set flag — the message-end handler will perform the actual restart
        // after project.json is guaranteed to be written by the MCP server.
        const contextKey = pending?.contextKey;
        if (contextKey) {
          get().markNeedsPhaseRestart(contextKey);
        }
      }
    }
    get().removePendingApproval(requestId);
  },

  setPendingQuestion: (contextKey, question) => {
    set((s) => updateSession(s, contextKey, () => ({ pendingQuestion: question })));
  },

  answerQuestion: async (contextKey, projectPath, answer) => {
    get().setPendingQuestion(contextKey, null);
    await get().sendMessage(contextKey, projectPath, answer);
  },

  addAutoAcceptRule: (toolName) => {
    set((s) => ({
      autoAcceptRules: new Set([...s.autoAcceptRules, toolName]),
    }));
  },

  clearAutoAcceptRules: () => set({ autoAcceptRules: new Set() }),

  markUnread: (contextKey) => {
    set((s) => ({
      unreadContextKeys: new Set([...s.unreadContextKeys, contextKey]),
    }));
  },

  markRead: (contextKey) => {
    set((s) => {
      if (!s.unreadContextKeys.has(contextKey)) return s;
      const next = new Set(s.unreadContextKeys);
      next.delete(contextKey);
      return { unreadContextKeys: next };
    });
  },
}));
