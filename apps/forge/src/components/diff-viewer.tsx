import { useEffect, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import * as tauri from "@/lib/tauri";

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

function parseDiff(raw: string): DiffLine[] {
  if (!raw.trim()) return [];
  return raw.split("\n").map((line) => {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) {
      return { type: "header", content: line };
    }
    if (line.startsWith("@@")) {
      return { type: "header", content: line };
    }
    if (line.startsWith("+")) {
      return { type: "add", content: line };
    }
    if (line.startsWith("-")) {
      return { type: "remove", content: line };
    }
    return { type: "context", content: line };
  });
}

const lineColors: Record<DiffLine["type"], string> = {
  add: "bg-green-500/10 text-green-400",
  remove: "bg-red-500/10 text-red-400",
  context: "text-muted-foreground",
  header: "text-blue-400 font-medium",
};

export function DiffViewer() {
  const { activeWorkspaceId, workspaces, setDiff } = useWorkspaceStore();
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const refreshDiff = useCallback(async () => {
    if (!workspace) return;
    try {
      const diff = await tauri.getWorktreeDiff(workspace.worktreePath);
      setDiff(workspace.id, diff);
    } catch (err) {
      console.error("Failed to get diff:", err);
    }
  }, [workspace?.id, workspace?.worktreePath, setDiff]);

  useEffect(() => {
    refreshDiff();
    const interval = setInterval(refreshDiff, 5000);
    return () => clearInterval(interval);
  }, [refreshDiff]);

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Select a workspace to view changes</p>
      </div>
    );
  }

  const lines = parseDiff(workspace.diff);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium">Changes</h2>
        <button
          onClick={refreshDiff}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Refresh
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-auto">
        {lines.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No changes yet
          </p>
        ) : (
          <pre className="p-4 text-xs leading-5">
            {lines.map((line, i) => (
              <div
                key={i}
                className={`px-2 ${lineColors[line.type]}`}
              >
                {line.content}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
