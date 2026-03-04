import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import type { PendingApproval } from "../stores/agent-store";
import { useAgentStore } from "../stores/agent-store";
import {
  actionBadgeStyles,
  actionLabels,
  PreviewCreate,
  PreviewUpdate,
  PreviewDelete,
  PreviewFileWrite,
  PreviewCommand,
  PreviewTransition,
} from "./approval-dialog";

function ApprovalPreview({ approval }: { approval: PendingApproval }) {
  const isFileWrite = approval.toolName.includes("write_project_file");
  const isCommand = approval.toolName.includes("execute_command");

  if (isCommand) return <PreviewCommand preview={approval.preview} />;
  if (isFileWrite) return <PreviewFileWrite preview={approval.preview} existing={approval.existing} />;
  if (approval.action === "create") return <PreviewCreate preview={approval.preview} />;
  if (approval.action === "update") return <PreviewUpdate existing={approval.existing} preview={approval.preview} />;
  if (approval.action === "delete") return <PreviewDelete title={approval.title} />;
  if (approval.action === "transition") return <PreviewTransition preview={approval.preview} />;
  return null;
}

function ApprovalToastContent({
  approval,
  toastId,
}: {
  approval: PendingApproval;
  toastId: string | number;
}) {
  const respondToApproval = useAgentStore((s) => s.respondToApproval);
  const addAutoAcceptRule = useAgentStore((s) => s.addAutoAcceptRule);
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [alwaysApprove, setAlwaysApprove] = useState(false);

  const isCommand = approval.toolName.includes("execute_command");
  const displayToolName = approval.toolName.replace(/^mcp__sensable__/, "");

  const handleApprove = () => {
    if (alwaysApprove) {
      addAutoAcceptRule(approval.toolName);
    }
    respondToApproval(approval.requestId, true);
    toast.dismiss(toastId);
  };

  const handleRejectClick = () => {
    if (!rejecting) {
      setRejecting(true);
      return;
    }
    respondToApproval(approval.requestId, false, reason.trim() || undefined);
    toast.dismiss(toastId);
  };

  const handleRejectCancel = () => {
    setRejecting(false);
    setReason("");
  };

  const handleRejectKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      respondToApproval(approval.requestId, false, reason.trim() || undefined);
      toast.dismiss(toastId);
    }
    if (e.key === "Escape") {
      handleRejectCancel();
    }
  };

  return (
    <div className="w-[380px] rounded-lg border border-border bg-background text-foreground shadow-xl">
      {/* Header */}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${actionBadgeStyles[approval.action]}`}
            >
              {actionLabels[approval.action]}
            </span>
            {approval.featureName && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                {approval.featureName}
              </span>
            )}
            <span className="truncate text-[10px] text-muted-foreground">
              {displayToolName}
            </span>
          </div>
          <p className="truncate text-xs font-medium">{approval.title}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={expanded ? "Collapse" : "Expand details"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Expandable preview */}
      {expanded && (
        <div className="max-h-48 overflow-y-auto border-t border-border px-3 py-2">
          <ApprovalPreview approval={approval} />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
        {rejecting ? (
          <div className="flex flex-1 items-center gap-1.5">
            <input
              type="text"
              autoFocus
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={handleRejectKeyDown}
              className="min-w-0 flex-1 rounded border border-border bg-muted px-2 py-1 text-xs placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={handleRejectCancel}
              className="shrink-0 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRejectClick}
              className="shrink-0 rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700"
            >
              Reject
            </button>
          </div>
        ) : (
          <>
            {!isCommand && (
              <label className="mr-auto flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={alwaysApprove}
                  onChange={(e) => setAlwaysApprove(e.target.checked)}
                  className="rounded border-border"
                />
                Always
              </label>
            )}
            {isCommand && <div className="mr-auto" />}
            <button
              type="button"
              onClick={handleRejectClick}
              className="rounded bg-muted px-2.5 py-1 text-[10px] text-foreground hover:bg-muted/80"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleApprove}
              className="rounded bg-green-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-green-700"
            >
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Hook that watches pendingApprovals and creates a persistent sonner toast per approval.
 * Mount once in app.tsx alongside <Toaster />.
 */
export function useApprovalToasts() {
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const shownRef = useRef(new Set<string>());

  useEffect(() => {
    const currentIds = new Set(pendingApprovals.map((a) => a.requestId));

    // Show toasts for new approvals (plan approvals are handled by PlanDialog)
    for (const approval of pendingApprovals) {
      if (approval.action === "plan") continue;
      if (!shownRef.current.has(approval.requestId)) {
        shownRef.current.add(approval.requestId);
        const toastId = `approval-${approval.requestId}`;
        toast.custom(
          () => <ApprovalToastContent approval={approval} toastId={toastId} />,
          {
            id: toastId,
            duration: Infinity,
            position: "bottom-right",
          },
        );
      }
    }

    // Dismiss toasts for approvals that were resolved elsewhere (e.g. auto-accept)
    for (const id of shownRef.current) {
      if (!currentIds.has(id)) {
        toast.dismiss(`approval-${id}`);
        shownRef.current.delete(id);
      }
    }
  }, [pendingApprovals]);
}
