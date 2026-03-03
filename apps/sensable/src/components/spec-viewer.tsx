import { useEffect, useState } from "react";
import { listArtifacts, readArtifact } from "../lib/tauri";
import { useProjectStore } from "../stores/project-store";
import type { Spec } from "@sensable/schemas";

interface SpecViewerProps {
  featureId: string;
}

export function SpecViewer({ featureId }: SpecViewerProps) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSpecId, setActiveSpecId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    listArtifacts(projectPath, "discover", "specs", featureId)
      .then(async (summaries) => {
        const full = await Promise.all(
          (summaries as Array<{ id: string }>).map((s) =>
            readArtifact(projectPath, "discover", "specs", s.id, featureId),
          ),
        );
        const loaded = full as Spec[];
        setSpecs(loaded);
        if (loaded.length > 0 && !activeSpecId) {
          setActiveSpecId(loaded[0].id);
        }
      })
      .catch(() => setSpecs([]))
      .finally(() => setLoading(false));
  }, [projectPath, featureId]);

  if (loading) {
    return (
      <div className="py-4">
        <p className="text-xs text-muted-foreground">Loading specs...</p>
      </div>
    );
  }

  if (specs.length === 0) {
    return null;
  }

  const activeSpec = specs.find((s) => s.id === activeSpecId) ?? specs[0];

  return (
    <div>
      {/* Spec tabs if multiple */}
      {specs.length > 1 && (
        <div className="mb-3 flex gap-1">
          {specs.map((spec) => (
            <button
              key={spec.id}
              onClick={() => setActiveSpecId(spec.id)}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                spec.id === activeSpecId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {spec.title}
            </button>
          ))}
        </div>
      )}

      {/* Spec content */}
      <div className="rounded-lg border border-border">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">{activeSpec.title}</h3>
          <StatusBadge status={activeSpec.status} />
        </div>

        {/* Overview */}
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground/80">
            {activeSpec.overview}
          </p>
        </div>

        {/* User Stories */}
        {activeSpec.userStories.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              User Stories
            </h4>
            <div className="space-y-2">
              {activeSpec.userStories.map((story, i) => (
                <div
                  key={i}
                  className="rounded-md bg-accent/30 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">As a </span>
                  <span className="font-medium">{story.asA}</span>
                  <span className="text-muted-foreground">, I want </span>
                  <span className="font-medium">{story.iWant}</span>
                  <span className="text-muted-foreground">, so that </span>
                  <span className="font-medium">{story.soThat}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acceptance Criteria */}
        {activeSpec.acceptanceCriteria.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Acceptance Criteria
            </h4>
            <ul className="space-y-1">
              {activeSpec.acceptanceCriteria.map((criterion, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border" />
                  <span className="text-foreground/80">{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Out of Scope */}
        {activeSpec.outOfScope.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Out of Scope
            </h4>
            <ul className="space-y-1">
              {activeSpec.outOfScope.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span className="shrink-0">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Open Questions */}
        {activeSpec.openQuestions.length > 0 && (
          <div className="px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Open Questions
            </h4>
            <ul className="space-y-1">
              {activeSpec.openQuestions.map((q, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span className="shrink-0">?</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-yellow-500/10 text-yellow-400",
    review: "bg-blue-500/10 text-blue-400",
    approved: "bg-green-500/10 text-green-400",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status] ?? "bg-accent text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}
