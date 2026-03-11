import { useInspectorStore } from "../stores/inspector-store";

export function InspectToggle() {
  const inspectMode = useInspectorStore((s) => s.inspectMode);
  const toggleInspect = useInspectorStore((s) => s.toggleInspect);

  return (
    <button
      onClick={toggleInspect}
      className={`rounded p-1 transition-colors ${
        inspectMode
          ? "bg-blue-500/20 text-blue-400"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      title={inspectMode ? "Exit inspect mode" : "Inspect element"}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Crosshair icon */}
        <circle cx="8" cy="8" r="5" />
        <line x1="8" y1="1" x2="8" y2="4" />
        <line x1="8" y1="12" x2="8" y2="15" />
        <line x1="1" y1="8" x2="4" y2="8" />
        <line x1="12" y1="8" x2="15" y2="8" />
      </svg>
    </button>
  );
}
