import { useState, type KeyboardEvent } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import type { PendingApproval } from "../stores/agent-store";

interface PlanDialogProps {
  approval: PendingApproval;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string, reason?: string) => void;
}

export function PlanDialog({ approval, onApprove, onReject }: PlanDialogProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const content =
    approval.preview !== null && typeof approval.preview === "object"
      ? (approval.preview as Record<string, unknown>).content
      : null;
  const markdownContent = typeof content === "string" ? content : "";

  const handleRejectClick = () => {
    if (!rejecting) {
      setRejecting(true);
      return;
    }
    onReject(approval.requestId, reason.trim() || undefined);
  };

  const handleRejectCancel = () => {
    setRejecting(false);
    setReason("");
  };

  const handleRejectKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onReject(approval.requestId, reason.trim() || undefined);
    }
    if (e.key === "Escape") {
      handleRejectCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background text-foreground shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-400">
            Plan
          </span>
          <h2 className="text-sm font-semibold">{approval.title}</h2>
        </div>

        {/* Scrollable markdown body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <MarkdownRenderer content={markdownContent} />
        </div>

        {/* Footer with actions */}
        <div className="shrink-0 border-t border-border px-6 py-3">
          {rejecting ? (
            <div className="flex items-start gap-2">
              <textarea
                autoFocus
                placeholder="Why are you rejecting? What should change? (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={handleRejectKeyDown}
                rows={2}
                className="flex-1 resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground"
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleRejectCancel}
                  className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectClick}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleRejectClick}
                className="rounded-md bg-muted px-4 py-2 text-sm text-foreground hover:bg-muted/80"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => onApprove(approval.requestId)}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Approve Plan
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
