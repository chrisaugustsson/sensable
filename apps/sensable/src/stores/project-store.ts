import { create } from "zustand";
import type { Project, Feature, CurrentView } from "@sensable/schemas";
import * as tauri from "../lib/tauri";
import { useAgentStore, deriveContextKey, getSessionState } from "./agent-store";

/** Stop all running agents and reset the agent store. */
async function stopAllAndReset() {
  await useAgentStore.getState().resetAll();
}

/** Check if a context key has an active (non-offline) agent. */
function hasActiveAgent(contextKey: string): boolean {
  const session = getSessionState(useAgentStore.getState().sessions, contextKey);
  return session.status !== "offline";
}

interface ProjectState {
  project: Project | null;
  projectPath: string | null;
  isLoading: boolean;
  error: string | null;
  fileWriteVersion: number;
  /** Set when navigating within same feature to different phase while agent is active. */
  pendingNavigation: { view: CurrentView; featureName: string } | null;

  createProject: (
    name: string,
    description: string,
    path: string,
  ) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  closeProject: () => void;
  setView: (view: CurrentView) => void;
  confirmNavigation: () => Promise<void>;
  cancelNavigation: () => void;
  createFeature: (name: string, description: string) => Promise<Feature | null>;
  updateFeature: (feature: Feature) => Promise<void>;
  deleteFeature: (featureId: string) => Promise<void>;
  bumpFileWriteVersion: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectPath: null,
  isLoading: false,
  error: null,
  fileWriteVersion: 0,
  pendingNavigation: null,

  createProject: async (name, description, path) => {
    set({ isLoading: true, error: null });
    try {
      const project = await tauri.createProject(name, description, path);
      await stopAllAndReset();
      set({ project, projectPath: path, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  openProject: async (path) => {
    set({ isLoading: true, error: null });
    try {
      const project = await tauri.openProject(path);
      await stopAllAndReset();
      set({ project, projectPath: path, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  closeProject: () => {
    stopAllAndReset();
    set({ project: null, projectPath: null, error: null, pendingNavigation: null });
  },

  setView: (view) => {
    const { project, projectPath } = get();
    if (!project || !projectPath) return;

    const prev = project.currentView;
    const prevKey = deriveContextKey(project);

    // Same feature, different phase → guard if agent is active
    if (
      prev.type === "feature" &&
      view.type === "feature" &&
      prev.featureId === view.featureId &&
      prev.phase !== view.phase &&
      hasActiveAgent(prevKey)
    ) {
      const feature = project.features.find((f) => f.id === prev.featureId);
      set({ pendingNavigation: { view, featureName: feature?.name ?? "this feature" } });
      return;
    }

    // App view → app view: stop the app agent (current behavior)
    if (prev.type === "app" && view.type === "app" && hasActiveAgent(prevKey)) {
      useAgentStore.getState().resetSession(prevKey);
    }

    // Feature → different feature, or feature ↔ app: just switch — don't kill anything

    // Optimistic update
    const updated = { ...project, currentView: view };
    set({ project: updated, pendingNavigation: null });

    // Persist (the Rust side also updates feature.currentPhase if navigating to a feature phase)
    tauri.setView(projectPath, view).then((persisted) => {
      set({ project: persisted });
    }).catch(console.error);
  },

  confirmNavigation: async () => {
    const { pendingNavigation, project, projectPath } = get();
    if (!pendingNavigation || !project || !projectPath) return;

    const prevKey = deriveContextKey(project);
    await useAgentStore.getState().resetSession(prevKey);

    const updated = { ...project, currentView: pendingNavigation.view };
    set({ project: updated, pendingNavigation: null });

    tauri.setView(projectPath, pendingNavigation.view).then((persisted) => {
      set({ project: persisted });
    }).catch(console.error);
  },

  cancelNavigation: () => {
    set({ pendingNavigation: null });
  },

  createFeature: async (name, description) => {
    const { project, projectPath } = get();
    if (!project || !projectPath) return null;

    try {
      const feature = await tauri.createFeature(projectPath, name, description);
      // Re-read project to get the updated features array
      const updated = await tauri.openProject(projectPath);
      set({ project: updated });
      return feature;
    } catch (e) {
      console.error("Failed to create feature:", e);
      return null;
    }
  },

  updateFeature: async (feature) => {
    const { project, projectPath } = get();
    if (!project || !projectPath) return;

    try {
      await tauri.updateFeature(projectPath, feature);
      const updated = {
        ...project,
        features: project.features.map((f) =>
          f.id === feature.id ? feature : f,
        ),
      };
      set({ project: updated });
    } catch (e) {
      console.error("Failed to update feature:", e);
    }
  },

  bumpFileWriteVersion: () => set((s) => ({ fileWriteVersion: s.fileWriteVersion + 1 })),

  deleteFeature: async (featureId) => {
    const { project, projectPath } = get();
    if (!project || !projectPath) return;

    try {
      await tauri.deleteFeature(projectPath, featureId);
      const updated = await tauri.openProject(projectPath);
      set({ project: updated });
    } catch (e) {
      console.error("Failed to delete feature:", e);
    }
  },
}));

// Derived selectors
export function useCurrentFeature(): Feature | null {
  return useProjectStore((s) => {
    const project = s.project;
    if (!project) return null;
    const view = project.currentView;
    if (view.type !== "feature") return null;
    const { featureId } = view;
    return project.features.find((f) => f.id === featureId) ?? null;
  });
}

export function useSelectedFeatureId(): string | null {
  return useProjectStore((s) => {
    const project = s.project;
    if (!project) return null;
    const view = project.currentView;
    if (view.type !== "feature") return null;
    return view.featureId;
  });
}
