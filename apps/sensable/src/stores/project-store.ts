import { create } from "zustand";
import type { Project, Feature, CurrentView } from "@sensable/schemas";
import * as tauri from "../lib/tauri";
import { useAgentStore } from "./agent-store";

/** Stop all running agents and reset the agent store. */
async function stopAllAndReset() {
  await useAgentStore.getState().resetAll();
}

export type DevelopSubStep = "wireframes" | "prototype";

export interface DesignSystemFocus {
  type: "layouts" | "components";
  itemId: string;
}

interface ProjectState {
  project: Project | null;
  projectPath: string | null;
  isLoading: boolean;
  error: string | null;
  fileWriteVersion: number;
  /** Transient: tracks which sub-step is active within Develop phase (not persisted). */
  developSubStep: DevelopSubStep;
  /** Transient: tracks the focused layout/component in the design system view (not persisted). */
  designSystemFocus: DesignSystemFocus | null;

  createProject: (
    name: string,
    description: string,
    path: string,
  ) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  closeProject: () => void;
  setView: (view: CurrentView) => void;
  setDevelopSubStep: (subStep: DevelopSubStep) => void;
  setDesignSystemFocus: (focus: DesignSystemFocus | null) => void;
  createFeature: (name: string, description: string) => Promise<Feature | null>;
  updateFeature: (feature: Feature) => Promise<void>;
  deleteFeature: (featureId: string) => Promise<void>;
  setFramework: (framework: "react" | "vue") => Promise<void>;
  bumpFileWriteVersion: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectPath: null,
  isLoading: false,
  error: null,
  fileWriteVersion: 0,
  developSubStep: "wireframes",
  designSystemFocus: null,

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
    set({ project: null, projectPath: null, error: null });
  },

  setView: (view) => {
    const { project, projectPath } = get();
    if (!project || !projectPath) return;

    // Optimistic update — agents keep running in their own contexts
    const updated = { ...project, currentView: view };
    set({ project: updated });

    // Persist (the Rust side also updates feature.currentPhase if navigating to a feature phase)
    tauri.setView(projectPath, view).then((persisted) => {
      set({ project: persisted });
    }).catch(console.error);
  },

  setDevelopSubStep: (subStep) => set({ developSubStep: subStep }),
  setDesignSystemFocus: (focus) => set({ designSystemFocus: focus }),

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

  setFramework: async (framework) => {
    const { project, projectPath } = get();
    if (!project || !projectPath) return;

    const updated = { ...project, framework };
    set({ project: updated });

    try {
      const persisted = await tauri.updateProject(projectPath, updated);
      set({ project: persisted });
    } catch (e) {
      console.error("Failed to update framework:", e);
      set({ project }); // rollback
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
