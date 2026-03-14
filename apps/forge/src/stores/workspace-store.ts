import { create } from "zustand";

export type WorkspaceStatus = "creating" | "active" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Workspace {
  id: string;
  name: string;
  branch: string;
  worktreePath: string;
  status: WorkspaceStatus;
  error?: string;
  messages: ChatMessage[];
  diff: string;
}

interface WorkspaceState {
  repoPath: string | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  setRepoPath: (path: string) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;
  addMessage: (workspaceId: string, message: ChatMessage) => void;
  setDiff: (workspaceId: string, diff: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  repoPath: null,
  workspaces: [],
  activeWorkspaceId: null,

  setRepoPath: (path) => set({ repoPath: path }),

  addWorkspace: (workspace) =>
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    })),

  removeWorkspace: (id) =>
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id),
      activeWorkspaceId:
        state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
    })),

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  updateWorkspace: (id, updates) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === id ? { ...w, ...updates } : w,
      ),
    })),

  addMessage: (workspaceId, message) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, messages: [...w.messages, message] }
          : w,
      ),
    })),

  setDiff: (workspaceId, diff) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, diff } : w,
      ),
    })),
}));
