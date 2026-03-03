import { useState } from "react";
import type { Feature, FeaturePhaseName } from "@sensable/schemas";
import {
  useProjectStore,
} from "../stores/project-store";
import { useAgentStore, getSessionState, type AgentStatusType } from "../stores/agent-store";

function statusDot(status: string) {
  if (status === "complete") return "bg-green-500";
  if (status === "in-progress") return "bg-blue-500";
  return "bg-transparent";
}

function featureStatusLabel(feature: Feature): string {
  const phase = feature.currentPhase;
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/** Derive agent status for a feature from the sessions map. */
function useFeatureAgentStatus(featureId: string): AgentStatusType {
  return useAgentStore((s) => {
    const session = getSessionState(s.sessions, `feature:${featureId}`);
    return session.status;
  });
}

/** Check if a feature has pending approvals. */
function useFeatureHasPendingApproval(featureId: string): boolean {
  return useAgentStore((s) =>
    s.pendingApprovals.some((a) => a.contextKey === `feature:${featureId}`),
  );
}

function useFeatureApprovalCount(featureId: string): number {
  return useAgentStore((s) =>
    s.pendingApprovals.filter((a) => a.contextKey === `feature:${featureId}`).length,
  );
}

function useFeatureHasQuestion(featureId: string): boolean {
  return useAgentStore((s) => {
    const session = getSessionState(s.sessions, `feature:${featureId}`);
    return session.pendingQuestion !== null;
  });
}

function useFeatureIsUnread(featureId: string): boolean {
  return useAgentStore((s) => s.unreadContextKeys.has(`feature:${featureId}`));
}

function FeatureAgentDot({ featureId }: { featureId: string }) {
  const status = useFeatureAgentStatus(featureId);
  const hasPendingApproval = useFeatureHasPendingApproval(featureId);

  if (hasPendingApproval) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" title="Pending approval" />;
  }
  if (status === "thinking" || status === "starting") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500 animate-pulse" title="Agent thinking" />;
  }
  if (status === "running") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" title="Agent idle" />;
  }
  if (status === "error") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Agent error" />;
  }
  return null;
}

function FeatureBadges({ featureId }: { featureId: string }) {
  const approvalCount = useFeatureApprovalCount(featureId);
  const hasQuestion = useFeatureHasQuestion(featureId);
  const isUnread = useFeatureIsUnread(featureId);

  if (!approvalCount && !hasQuestion && !isUnread) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {approvalCount > 0 && (
        <span
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white"
          title={`${approvalCount} pending approval${approvalCount > 1 ? "s" : ""}`}
        >
          {approvalCount}
        </span>
      )}
      {hasQuestion && (
        <span
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white"
          title="Waiting for your answer"
        >
          ?
        </span>
      )}
      {isUnread && !approvalCount && !hasQuestion && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-foreground/50"
          title="Unread agent response"
        />
      )}
    </span>
  );
}

export function PipelineSidebar() {
  const project = useProjectStore((s) => s.project);
  const setView = useProjectStore((s) => s.setView);
  const createFeature = useProjectStore((s) => s.createFeature);
  const closeProject = useProjectStore((s) => s.closeProject);

  const [featuresExpanded, setFeaturesExpanded] = useState(true);
  const [isAddingFeature, setIsAddingFeature] = useState(false);
  const [newFeatureName, setNewFeatureName] = useState("");
  const [newFeatureDesc, setNewFeatureDesc] = useState("");

  const currentView = project?.currentView;
  const isAppView = currentView?.type === "app";
  const appViewName = isAppView ? currentView.view : null;
  const selectedFeatureId =
    currentView?.type === "feature" ? currentView.featureId : null;

  async function handleCreateFeature() {
    if (!newFeatureName.trim()) return;
    await createFeature(newFeatureName.trim(), newFeatureDesc.trim());
    setNewFeatureName("");
    setNewFeatureDesc("");
    setIsAddingFeature(false);
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border">
      <div className="flex-1 overflow-auto">
        <div className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Project
          </p>
        </div>

        <nav className="space-y-0.5 px-2">
          {/* Project Spec */}
          <button
            onClick={() => setView({ type: "app", view: "project" })}
            disabled={!project}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
              appViewName === "project"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            }`}
          >
            <span className="flex-1">Project</span>
          </button>

          {/* Overview */}
          <button
            onClick={() => setView({ type: "app", view: "overview" })}
            disabled={!project}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
              appViewName === "overview"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            }`}
          >
            <span className="flex-1">Overview</span>
          </button>

          {/* Features section — collapsible */}
          <div className="pt-3">
            <div className="flex items-center justify-between px-3 pb-1">
              <button
                onClick={() => setFeaturesExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg
                  className={`h-3 w-3 transition-transform ${featuresExpanded ? "rotate-90" : ""}`}
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Features
              </button>
              {project && (
                <button
                  onClick={() => {
                    setFeaturesExpanded(true);
                    setIsAddingFeature(true);
                  }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title="Add feature"
                >
                  +
                </button>
              )}
            </div>

            {featuresExpanded && (
              <>
                {/* Add feature form */}
                {isAddingFeature && (
                  <div className="mx-1 mb-1 rounded-md border border-border bg-accent/30 p-2">
                    <input
                      type="text"
                      placeholder="Feature name"
                      value={newFeatureName}
                      onChange={(e) => setNewFeatureName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateFeature();
                        if (e.key === "Escape") setIsAddingFeature(false);
                      }}
                      className="mb-1 w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Description (optional)"
                      value={newFeatureDesc}
                      onChange={(e) => setNewFeatureDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateFeature();
                        if (e.key === "Escape") setIsAddingFeature(false);
                      }}
                      className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={handleCreateFeature}
                        className="rounded bg-foreground px-2 py-0.5 text-[10px] text-background transition-opacity hover:opacity-80"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setIsAddingFeature(false)}
                        className="rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Feature list */}
                {project?.features.map((feature) => (
                  <button
                    key={feature.id}
                    onClick={() =>
                      setView({
                        type: "feature",
                        featureId: feature.id,
                        phase: feature.currentPhase as FeaturePhaseName,
                      })
                    }
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                      selectedFeatureId === feature.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{feature.name}</span>
                    <FeatureBadges featureId={feature.id} />
                    <FeatureAgentDot featureId={feature.id} />
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {featureStatusLabel(feature)}
                    </span>
                  </button>
                ))}

                {project && project.features.length === 0 && !isAddingFeature && (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">
                    No features yet. Use the agent to define them.
                  </p>
                )}
              </>
            )}
          </div>

          {/* App-level phases */}
          <div className="pt-3">
            <div className="px-3 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                App-Level
              </p>
            </div>

            <button
              onClick={() => setView({ type: "app", view: "architect" })}
              disabled={!project}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
                appViewName === "architect"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <span className="flex-1">Architecture</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDot(
                  project?.appPhases.architect?.status ?? "not-started",
                )}`}
              />
            </button>

            <button
              onClick={() => setView({ type: "app", view: "design-system" })}
              disabled={!project}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
                appViewName === "design-system"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <span className="flex-1">Design System</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDot(
                  project?.designSystem?.status ?? "not-started",
                )}`}
              />
            </button>

            <button
              onClick={() => setView({ type: "app", view: "build" })}
              disabled={!project}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
                appViewName === "build"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <span className="flex-1">Build</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDot(
                  project?.appPhases.build?.status ?? "not-started",
                )}`}
              />
            </button>
          </div>
        </nav>
      </div>

      {/* Close project button */}
      {project && (
        <div className="border-t border-border p-3">
          <button
            onClick={closeProject}
            className="w-full rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Close project
          </button>
        </div>
      )}
    </aside>
  );
}
