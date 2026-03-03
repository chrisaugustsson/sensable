import { create } from "zustand";
import type { Project } from "@sensable/schemas";
import * as tauri from "../lib/tauri";

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

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks: ContentBlock[];
  timestamp: number;
  isStreaming?: boolean;
  toolCalls?: { name: string; input: unknown }[];
  images?: MessageImage[];
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
  action: "create" | "update" | "delete" | "transition";
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

/** Per-agent session state, keyed by context key. */
export interface AgentSessionState {
  messages: AgentMessage[];
  isStreaming: boolean;
  status: AgentStatusType;
  sessionId: string | null;
  error: string | null;
  pendingQuestion: PendingUserQuestion | null;
}

const defaultSessionState: AgentSessionState = {
  messages: [],
  isStreaming: false,
  status: "offline",
  sessionId: null,
  error: null,
  pendingQuestion: null,
};

/** Derive a context key from the current project state. */
export function deriveContextKey(project: Project | null): string {
  if (!project) return "app:overview";
  if (project.onboarding?.status && project.onboarding.status !== "complete") {
    return `app:onboarding-${project.onboarding.status}`;
  }
  const view = project.currentView;
  if (view.type === "feature") return `feature:${view.featureId}`;
  return `app:${view.view}`;
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
  clearMessages: (contextKey: string) => void;
  resetSession: (contextKey: string) => Promise<void>;
  resetAll: () => Promise<void>;

  // Approval actions
  addPendingApproval: (approval: PendingApproval) => void;
  removePendingApproval: (requestId: string) => void;
  respondToApproval: (requestId: string, approved: boolean, reason?: string) => Promise<void>;

  // Question actions
  setPendingQuestion: (contextKey: string, question: PendingUserQuestion | null) => void;
  answerQuestion: (contextKey: string, projectPath: string, answer: string) => Promise<void>;

  // Auto-accept
  addAutoAcceptRule: (toolName: string) => void;
  clearAutoAcceptRules: () => void;

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
        await tauri.sendAgentMessage(contextKey, content, tauriImages);
      } else {
        await tauri.startAgent(projectPath, contextKey, content, tauriImages);
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

  addPendingApproval: (approval) => {
    set((s) => ({ pendingApprovals: [...s.pendingApprovals, approval] }));
  },

  removePendingApproval: (requestId) => {
    set((s) => ({
      pendingApprovals: s.pendingApprovals.filter((a) => a.requestId !== requestId),
    }));
  },

  respondToApproval: async (requestId, approved, reason) => {
    const pending = get().pendingApprovals.find((a) => a.requestId === requestId);
    try {
      await tauri.respondToApproval(requestId, approved, reason);
    } catch (e) {
      console.error("Failed to respond to approval:", e);
    }
    if (approved && pending?.toolName.includes("write_project_file")) {
      const { useProjectStore } = await import("./project-store");
      useProjectStore.getState().bumpFileWriteVersion();
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
