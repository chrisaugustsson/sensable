import { useMemo, useState } from "react";
import { useAgentStore, deriveContextKey, featureIdFromContextKey, phaseFromContextKey, type AgentStatusType } from "../stores/agent-store";
import { useProjectStore } from "../stores/project-store";
import type { FeaturePhaseName } from "@sensable/schemas";

const phaseDisplayNames: Record<string, string> = {
  discover: "Discover",
  define: "Define",
  develop: "Develop",
  deliver: "Deliver",
};

const appViewDisplayNames: Record<string, string> = {
  overview: "Overview",
  architect: "Architecture",
  "design-system": "Design System",
  build: "Build",
  project: "Project Spec",
};

interface ActiveSession {
  contextKey: string;
  status: AgentStatusType;
  label: string;
  featureId?: string;
  phase?: string;
  appView?: string;
  dsItemType?: "layouts" | "components";
  dsItemId?: string;
  isCurrent: boolean;
}

const statusDots: Record<string, string> = {
  thinking: "bg-blue-400 animate-pulse",
  starting: "bg-yellow-400 animate-pulse",
  running: "bg-green-400",
  error: "bg-red-400",
};

function useAllActiveSessions(currentContextKey: string): ActiveSession[] {
  const sessions = useAgentStore((s) => s.sessions);
  const project = useProjectStore((s) => s.project);

  return useMemo(() => {
    if (!project) return [];
    const result: ActiveSession[] = [];

    for (const [key, session] of Object.entries(sessions)) {
      if (session.status === "offline") continue;

      const fid = featureIdFromContextKey(key);
      const phase = phaseFromContextKey(key);

      if (fid && phase) {
        const feature = project.features.find((f) => f.id === fid);
        const featureName = feature?.name ?? "Unknown";
        const phaseLabel = phaseDisplayNames[phase] ?? phase;
        result.push({
          contextKey: key,
          status: session.status,
          label: `${featureName} — ${phaseLabel}`,
          featureId: fid,
          phase,
          isCurrent: key === currentContextKey,
        });
      } else if (key.startsWith("app:design-system:")) {
        // Per-item design system session: app:design-system:{type}:{itemId}
        const parts = key.split(":");
        const itemType = parts[2]; // "layouts" or "components"
        const itemId = parts[3];
        const ds = project.designSystem;
        const items = itemType === "layouts" ? ds?.layouts : ds?.components;
        const item = items?.find((i) => i.id === itemId);
        const itemName = item?.name ?? itemId;
        const typeLabel = itemType === "layouts" ? "Layout" : "Component";
        result.push({
          contextKey: key,
          status: session.status,
          label: `${typeLabel}: ${itemName}`,
          appView: "design-system",
          dsItemType: itemType as "layouts" | "components",
          dsItemId: itemId,
          isCurrent: key === currentContextKey,
        });
      } else if (key.startsWith("app:")) {
        const view = key.slice(4);
        result.push({
          contextKey: key,
          status: session.status,
          label: appViewDisplayNames[view] ?? view,
          appView: view,
          isCurrent: key === currentContextKey,
        });
      }
    }

    result.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    return result;
  }, [sessions, project, currentContextKey]);
}

export function ActiveSessionsMenu() {
  const [open, setOpen] = useState(false);
  const project = useProjectStore((s) => s.project);
  const setView = useProjectStore((s) => s.setView);
  const setDesignSystemFocus = useProjectStore((s) => s.setDesignSystemFocus);
  const resetSession = useAgentStore((s) => s.resetSession);
  const currentContextKey = deriveContextKey(project);
  const sessions = useAllActiveSessions(currentContextKey);

  if (sessions.length === 0) return null;

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  function handleGoTo(s: ActiveSession) {
    if (s.featureId && s.phase) {
      setView({ type: "feature", featureId: s.featureId, phase: s.phase as FeaturePhaseName });
    } else if (s.dsItemType && s.dsItemId) {
      setDesignSystemFocus({ type: s.dsItemType, itemId: s.dsItemId });
      setView({ type: "app", view: "design-system" });
    } else if (s.appView) {
      setView({ type: "app", view: s.appView as any });
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-1 text-[10px] text-blue-400 hover:bg-blue-500/10 transition-colors"
      >
        <span className="flex gap-0.5">
          {sessions.map((s) => (
            <span key={s.contextKey} className={`inline-block h-1.5 w-1.5 rounded-full ${statusDots[s.status] ?? "bg-muted"}`} />
          ))}
        </span>
        {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-background shadow-xl">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Active Sessions
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {sessions.map((s) => (
                <div
                  key={s.contextKey}
                  className={`flex items-center gap-2 px-3 py-1.5 ${s.isCurrent ? "bg-accent/50" : "hover:bg-accent/30"}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDots[s.status] ?? "bg-muted"}`} />
                  <span className={`flex-1 truncate text-[11px] ${s.isCurrent ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {s.label}
                    {s.isCurrent && <span className="ml-1 text-[9px] text-muted-foreground/60">(current)</span>}
                  </span>
                  {!s.isCurrent && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleGoTo(s)}
                        className="rounded px-1.5 py-0.5 text-[9px] text-blue-400 hover:bg-blue-500/10 transition-colors"
                      >
                        Go to
                      </button>
                      <button
                        type="button"
                        onClick={() => resetSession(s.contextKey)}
                        className="rounded px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        title="Stop this session"
                      >
                        Stop
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
