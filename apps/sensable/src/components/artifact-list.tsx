import { useEffect, useState } from "react";
import { listArtifacts, readArtifact } from "../lib/tauri";
import { useProjectStore } from "../stores/project-store";

interface ArtifactSummary {
  id: string;
  title: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface ArtifactListProps {
  featureId: string;
  phase: string;
  artifactType: string;
  label: string;
  emptyHint?: string;
  renderDetail?: (artifact: Record<string, unknown>) => React.ReactNode;
}

export function ArtifactList({
  featureId,
  phase,
  artifactType,
  label,
  emptyHint,
  renderDetail,
}: ArtifactListProps) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    listArtifacts(projectPath, phase, artifactType, featureId)
      .then((data) => {
        setArtifacts(data as ArtifactSummary[]);
      })
      .catch(() => setArtifacts([]))
      .finally(() => setLoading(false));
  }, [projectPath, featureId, phase, artifactType]);

  async function handleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    if (!projectPath) return;
    try {
      const data = await readArtifact(projectPath, phase, artifactType, id, featureId);
      setDetail(data as Record<string, unknown>);
    } catch {
      setDetail(null);
    }
  }

  if (loading) {
    return (
      <div className="py-2">
        <p className="text-xs text-muted-foreground">Loading {label}...</p>
      </div>
    );
  }

  if (artifacts.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="py-2">
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label} ({artifacts.length})
      </h4>
      <div className="space-y-1.5">
        {artifacts.map((artifact) => (
          <div key={artifact.id}>
            <button
              onClick={() => handleExpand(artifact.id)}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                expandedId === artifact.id
                  ? "border-foreground/20 bg-accent"
                  : "border-border hover:border-foreground/10 hover:bg-accent/50"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {artifact.title}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatDate(artifact.updatedAt)}
              </span>
              <svg
                className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                  expandedId === artifact.id ? "rotate-90" : ""
                }`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
            {expandedId === artifact.id && detail && (
              <div className="mt-1 rounded-md border border-border bg-accent/30 p-3 text-sm">
                {renderDetail ? (
                  renderDetail(detail)
                ) : (
                  <DefaultArtifactDetail data={detail} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DefaultArtifactDetail({ data }: { data: Record<string, unknown> }) {
  const skip = new Set(["id", "createdAt", "updatedAt", "tags"]);
  const entries = Object.entries(data).filter(([key]) => !skip.has(key));

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {formatKey(key)}
          </span>
          <div className="mt-0.5 text-xs text-foreground/80">
            {renderValue(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function renderValue(value: unknown): React.ReactNode {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">None</span>;
    if (typeof value[0] === "string") {
      return (
        <ul className="list-inside list-disc space-y-0.5">
          {value.map((item, i) => (
            <li key={i}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    return <pre className="overflow-auto text-[10px]">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (value && typeof value === "object") {
    return <pre className="overflow-auto text-[10px]">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span className="text-muted-foreground">-</span>;
}
