import { useState, useEffect, useCallback } from "react";
import type { Feature, FeaturePhaseName } from "@sensable/schemas";
import {
  useProjectStore,
} from "../stores/project-store";
import { useAgentStore, getSessionState, featureIdFromContextKey, type AgentStatusType } from "../stores/agent-store";

function statusDot(status: string) {
  if (status === "complete") return "bg-green-500";
  if (status === "in-progress") return "bg-blue-500";
  return "bg-transparent";
}

function featureStatusLabel(feature: Feature): string {
  const phase = feature.currentPhase;
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/** Check if a context key belongs to a given feature. */
function isFeatureKey(contextKey: string, featureId: string): boolean {
  return featureIdFromContextKey(contextKey) === featureId;
}

/** Derive the "most active" agent status for a feature across all its phase sessions. */
function useFeatureAgentStatus(featureId: string): AgentStatusType {
  return useAgentStore((s) => {
    // Priority: thinking > starting > running > error > offline
    const priorities: AgentStatusType[] = ["thinking", "starting", "running", "error"];
    for (const key of Object.keys(s.sessions)) {
      if (!isFeatureKey(key, featureId)) continue;
      const session = s.sessions[key];
      for (const p of priorities) {
        if (session.status === p) return p;
      }
    }
    return "offline";
  });
}

/** Check if a feature has pending approvals (across all phases). */
function useFeatureHasPendingApproval(featureId: string): boolean {
  return useAgentStore((s) =>
    s.pendingApprovals.some((a) => isFeatureKey(a.contextKey, featureId)),
  );
}

function useFeatureApprovalCount(featureId: string): number {
  return useAgentStore((s) =>
    s.pendingApprovals.filter((a) => isFeatureKey(a.contextKey, featureId)).length,
  );
}

function useFeatureHasQuestion(featureId: string): boolean {
  return useAgentStore((s) => {
    for (const key of Object.keys(s.sessions)) {
      if (!isFeatureKey(key, featureId)) continue;
      if (s.sessions[key].pendingQuestion !== null) return true;
    }
    return false;
  });
}

function useFeatureIsUnread(featureId: string): boolean {
  return useAgentStore((s) => {
    for (const key of s.unreadContextKeys) {
      if (isFeatureKey(key, featureId)) return true;
    }
    return false;
  });
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

function ConfirmDeleteDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
        <p className="text-sm font-medium">Delete "{name}"?</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This will permanently remove all associated files.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ContextMenu({
  x,
  y,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-[120px] rounded-md border border-border bg-background py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-accent"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
        </svg>
        Delete
      </button>
    </div>
  );
}

export function PipelineSidebar() {
  const project = useProjectStore((s) => s.project);
  const setView = useProjectStore((s) => s.setView);
  const createFeature = useProjectStore((s) => s.createFeature);
  const deleteFeature = useProjectStore((s) => s.deleteFeature);
  const closeProject = useProjectStore((s) => s.closeProject);

  const [featuresExpanded, setFeaturesExpanded] = useState(true);
  const [isAddingFeature, setIsAddingFeature] = useState(false);
  const [newFeatureName, setNewFeatureName] = useState("");
  const [newFeatureDesc, setNewFeatureDesc] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; featureId: string; featureName: string } | null>(null);

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

  const handleDeleteFeature = useCallback(async (featureId: string) => {
    // Stop all active agents for this feature (across all phases)
    const agentStore = useAgentStore.getState();
    for (const key of Object.keys(agentStore.sessions)) {
      if (!isFeatureKey(key, featureId)) continue;
      const session = agentStore.sessions[key];
      if (session.status !== "offline") {
        await agentStore.resetSession(key);
      }
    }
    await deleteFeature(featureId);
    setConfirmDelete(null);
    setContextMenu(null);
  }, [deleteFeature]);

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
                  <div
                    key={feature.id}
                    className="group relative"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, featureId: feature.id, featureName: feature.name });
                    }}
                  >
                    <button
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
                      <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
                        {featureStatusLabel(feature)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ id: feature.id, name: feature.name });
                        }}
                        className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive group-hover:block"
                        title="Delete feature"
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
                        </svg>
                      </button>
                    </button>
                  </div>
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

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => {
            setConfirmDelete({ id: contextMenu.featureId, name: contextMenu.featureName });
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDeleteDialog
          name={confirmDelete.name}
          onConfirm={() => handleDeleteFeature(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Bottom actions */}
      {project && (
        <div className="border-t border-border p-3 space-y-0.5">
          <button
            onClick={() => setView({ type: "app", view: "settings" })}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
              appViewName === "settings"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
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
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" />
              <path d="M13.4 10a1.2 1.2 0 00.24 1.32l.04.04a1.44 1.44 0 11-2.04 2.04l-.04-.04a1.2 1.2 0 00-1.32-.24 1.2 1.2 0 00-.72 1.08v.12a1.44 1.44 0 11-2.88 0v-.06a1.2 1.2 0 00-.78-1.08 1.2 1.2 0 00-1.32.24l-.04.04a1.44 1.44 0 11-2.04-2.04l.04-.04a1.2 1.2 0 00.24-1.32 1.2 1.2 0 00-1.08-.72H1.44a1.44 1.44 0 110-2.88h.06a1.2 1.2 0 001.08-.78 1.2 1.2 0 00-.24-1.32l-.04-.04a1.44 1.44 0 112.04-2.04l.04.04a1.2 1.2 0 001.32.24h.06a1.2 1.2 0 00.72-1.08V1.44a1.44 1.44 0 112.88 0v.06a1.2 1.2 0 00.72 1.08 1.2 1.2 0 001.32-.24l.04-.04a1.44 1.44 0 112.04 2.04l-.04.04a1.2 1.2 0 00-.24 1.32v.06a1.2 1.2 0 001.08.72h.12a1.44 1.44 0 110 2.88h-.06a1.2 1.2 0 00-1.08.72z" />
            </svg>
            Settings
          </button>
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
