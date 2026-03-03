import { useState, type KeyboardEvent } from "react";
import type { PendingApproval } from "../stores/agent-store";

interface ApprovalDialogProps {
  approval: PendingApproval;
  onApprove: (requestId: string) => void;
  onApproveAlways: (requestId: string, toolName: string) => void;
  onReject: (requestId: string, reason?: string) => void;
}

const KNOWN_FIELDS = [
  "title",
  "description",
  "statement",
  "content",
  "source",
  "type",
  "priority",
  "status",
] as const;

function formatPreviewFields(data: unknown): {
  fields: { key: string; value: string }[];
  rest: Record<string, unknown>;
} {
  if (data === null || data === undefined || typeof data !== "object") {
    return { fields: [], rest: {} };
  }

  const obj = data as Record<string, unknown>;
  const fields: { key: string; value: string }[] = [];
  const rest: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (KNOWN_FIELDS.includes(key as (typeof KNOWN_FIELDS)[number])) {
      fields.push({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      });
    } else {
      rest[key] = value;
    }
  }

  return { fields, rest };
}

export const actionBadgeStyles: Record<string, string> = {
  create: "bg-green-500/20 text-green-400",
  update: "bg-blue-500/20 text-blue-400",
  delete: "bg-red-500/20 text-red-400",
  transition: "bg-yellow-500/20 text-yellow-400",
};

export const actionLabels: Record<string, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  transition: "Transition",
};

export function PreviewCreate({ preview }: { preview: unknown }) {
  const { fields, rest } = formatPreviewFields(preview);
  const hasRest = Object.keys(rest).length > 0;

  return (
    <div className="space-y-2">
      {fields.length > 0 && (
        <div className="space-y-1.5">
          {fields.map(({ key, value }) => (
            <div key={key}>
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {key}
              </span>
              <p className="text-sm text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}
      {hasRest && (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            Full JSON
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
            {JSON.stringify(rest, null, 2)}
          </pre>
        </details>
      )}
      {fields.length === 0 && !hasRest && preview !== null && preview !== undefined && (
        <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function PreviewUpdate({
  existing,
  preview,
}: {
  existing: unknown;
  preview: unknown;
}) {
  return (
    <div className="space-y-3">
      <div>
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Before
        </span>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
          {JSON.stringify(existing, null, 2)}
        </pre>
      </div>
      <div>
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          After
        </span>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
          {JSON.stringify(preview, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export function PreviewDelete({ title }: { title: string }) {
  return (
    <div className="rounded bg-red-500/10 px-3 py-2">
      <p className="text-sm text-red-400">
        This will permanently delete <strong>{title}</strong>. This action
        cannot be undone.
      </p>
    </div>
  );
}

export function PreviewFileWrite({ preview, existing }: { preview: unknown; existing?: unknown }) {
  const previewObj = preview !== null && typeof preview === "object"
    ? (preview as Record<string, unknown>)
    : {};
  const filePath = typeof previewObj.path === "string" ? previewObj.path : "unknown";
  const content = typeof previewObj.content === "string" ? previewObj.content : "";

  const existingObj = existing !== null && existing !== undefined && typeof existing === "object"
    ? (existing as Record<string, unknown>)
    : null;
  const existingContent = existingObj && typeof existingObj.content === "string"
    ? existingObj.content
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">File</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{filePath}</code>
      </div>
      {existingContent !== null && (
        <div>
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Current content
          </span>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-xs">
            {existingContent}
          </pre>
        </div>
      )}
      <div>
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {existingContent !== null ? "New content" : "Content"}
        </span>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-xs">
          {content}
        </pre>
      </div>
    </div>
  );
}

export function PreviewCommand({ preview }: { preview: unknown }) {
  const obj =
    preview !== null && typeof preview === "object"
      ? (preview as Record<string, unknown>)
      : {};
  const display = typeof obj.display === "string" ? obj.display : "unknown command";
  const workDir = typeof obj.workingDirectory === "string" ? obj.workingDirectory : ".";

  return (
    <div className="space-y-2">
      <div>
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Command
        </span>
        <pre className="mt-1 rounded bg-muted p-3 font-mono text-sm">
          $ {display}
        </pre>
      </div>
      {workDir !== "." && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Working directory
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{workDir}</code>
        </div>
      )}
    </div>
  );
}

export function PreviewTransition({ preview }: { preview: unknown }) {
  const obj =
    preview !== null && typeof preview === "object"
      ? (preview as Record<string, unknown>)
      : {};
  const from = typeof obj.currentPhase === "string" ? obj.currentPhase : "unknown";
  const to = typeof obj.targetPhase === "string" ? obj.targetPhase : "unknown";

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="rounded bg-muted px-2 py-1 font-medium capitalize">
        {from}
      </span>
      <span className="text-muted-foreground">&rarr;</span>
      <span className="rounded bg-muted px-2 py-1 font-medium capitalize">
        {to}
      </span>
    </div>
  );
}

export function ApprovalDialog({
  approval,
  onApprove,
  onApproveAlways,
  onReject,
}: ApprovalDialogProps) {
  const isFileWrite = approval.toolName.includes("write_project_file");
  const isCommand = approval.toolName.includes("execute_command");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [alwaysApprove, setAlwaysApprove] = useState(false);
  const displayToolName = approval.toolName.replace(/^mcp__sensable__/, "");

  const handleApprove = () => {
    if (alwaysApprove) {
      onApproveAlways(approval.requestId, approval.toolName);
    } else {
      onApprove(approval.requestId);
    }
  };

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

  const handleRejectKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onReject(approval.requestId, reason.trim() || undefined);
    }
    if (e.key === "Escape") {
      handleRejectCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background text-foreground shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${actionBadgeStyles[approval.action]}`}
              >
                {actionLabels[approval.action]}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {approval.toolName.replace(/^mcp__sensable__/, "")}
              </span>
            </div>
            {approval.phase && approval.artifactType && (
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {approval.phase} / {approval.artifactType}
              </p>
            )}
            <p className="text-sm font-medium">{approval.title}</p>
          </div>
        </div>

        {/* Preview */}
        <div className="max-h-64 overflow-y-auto px-5 py-4">
          {isCommand ? (
            <PreviewCommand preview={approval.preview} />
          ) : isFileWrite ? (
            <PreviewFileWrite preview={approval.preview} existing={approval.existing} />
          ) : approval.action === "create" ? (
            <PreviewCreate preview={approval.preview} />
          ) : approval.action === "update" ? (
            <PreviewUpdate
              existing={approval.existing}
              preview={approval.preview}
            />
          ) : approval.action === "delete" ? (
            <PreviewDelete title={approval.title} />
          ) : approval.action === "transition" ? (
            <PreviewTransition preview={approval.preview} />
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {rejecting ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                autoFocus
                placeholder="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={handleRejectKeyDown}
                className="flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm placeholder:text-muted-foreground"
              />
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
          ) : (
            <>
              {!isCommand && (
                <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={alwaysApprove}
                    onChange={(e) => setAlwaysApprove(e.target.checked)}
                    className="rounded border-border"
                  />
                  Always approve <code className="text-[10px]">{displayToolName}</code>
                </label>
              )}
              <button
                type="button"
                onClick={handleRejectClick}
                className="rounded-md bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-muted/80"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
