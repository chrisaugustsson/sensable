import { create } from "zustand";

export interface InspectedElement {
  tag: string;
  id: string;
  classes: string[];
  textContent: string;
  outerHTML: string;
  selector: string;
  ancestors: string[];
  previewType: "wireframe" | "prototype";
  featureId: string;
}

interface InspectorState {
  inspectMode: boolean;
  selectedElement: InspectedElement | null;
  enableInspect: () => void;
  disableInspect: () => void;
  toggleInspect: () => void;
  setSelectedElement: (el: InspectedElement) => void;
  clear: () => void;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  inspectMode: false,
  selectedElement: null,

  enableInspect: () => set({ inspectMode: true, selectedElement: null }),
  disableInspect: () => set({ inspectMode: false }),
  toggleInspect: () =>
    set((s) => ({
      inspectMode: !s.inspectMode,
      selectedElement: s.inspectMode ? null : s.selectedElement,
    })),
  setSelectedElement: (el) => set({ selectedElement: el, inspectMode: false }),
  clear: () => set({ selectedElement: null, inspectMode: false }),
}));
