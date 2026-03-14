import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import * as tauri from "@/lib/tauri";

export function Sidebar() {
  const {
    repoPath,
    workspaces,
    activeWorkspaceId,
    setRepoPath,
    addWorkspace,
    removeWorkspace,
    setActiveWorkspace,
    updateWorkspace,
  } = useWorkspaceStore();

  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleOpenRepo = async () => {
    const path = await tauri.openRepo();
    if (path) {
      setRepoPath(path);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!repoPath || !newName.trim()) return;

    setIsCreating(true);
    try {
      const result = await tauri.createWorktree(repoPath, newName);
      addWorkspace({
        id: result.id,
        name: newName.trim(),
        branch: result.branch,
        worktreePath: result.worktree_path,
        status: "active",
        messages: [],
        diff: "",
      });
      setNewName("");
    } catch (err) {
      console.error("Failed to create workspace:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveWorkspace = async (id: string, name: string) => {
    if (!repoPath) return;
    try {
      await tauri.removeWorktree(repoPath, name);
      removeWorkspace(id);
    } catch (err) {
      console.error("Failed to remove workspace:", err);
      updateWorkspace(id, { status: "error", error: String(err) });
    }
  };

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
        <p className="text-sm text-muted-foreground">Open a repository to start</p>
        <button
          onClick={handleOpenRepo}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Open Repository
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <p className="truncate text-xs text-muted-foreground" title={repoPath}>
          {repoPath.split("/").pop()}
        </p>
      </div>

      <div className="border-b border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateWorkspace();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workspace name..."
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            disabled={isCreating}
          />
          <button
            type="submit"
            disabled={isCreating || !newName.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isCreating ? "..." : "+"}
          </button>
        </form>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {workspaces.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No workspaces yet
          </p>
        ) : (
          <ul className="p-2">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <button
                  onClick={() => setActiveWorkspace(ws.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    activeWorkspaceId === ws.id
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{ws.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ws.branch}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveWorkspace(ws.id, ws.name);
                    }}
                    className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                    title="Remove workspace"
                  >
                    ×
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
