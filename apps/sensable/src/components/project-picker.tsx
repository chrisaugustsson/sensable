import { useState } from "react";
import { useProjectStore } from "../stores/project-store";
import { pickFolder, checkProjectExists } from "../lib/tauri";

export function ProjectPicker() {
  const { createProject, openProject, isLoading, error } = useProjectStore();
  const [mode, setMode] = useState<"choose" | "create">("choose");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  async function handlePickFolder() {
    const path = await pickFolder();
    if (path) {
      setSelectedPath(path);
    }
  }

  async function handleOpenExisting() {
    const path = await pickFolder();
    if (!path) return;

    const exists = await checkProjectExists(path);
    if (exists) {
      await openProject(path);
    } else {
      // No .sensable found — offer to create
      setSelectedPath(path);
      setMode("create");
    }
  }

  async function handleCreate() {
    if (!name.trim() || !selectedPath) return;
    await createProject(name.trim(), description.trim(), selectedPath);
  }

  if (mode === "create") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="text-lg font-semibold">New Project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set up a new Sensable project to start your design process.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Project name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Product"
                autoFocus
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What are you building and why?"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Location
              </label>
              <div className="flex gap-2">
                <span className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {selectedPath || "No folder selected"}
                </span>
                <button
                  onClick={handlePickFolder}
                  className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setMode("choose")}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || !selectedPath || isLoading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isLoading ? "Creating..." : "Create Project"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-bold tracking-tight">Sensable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Make it make sense. Guide your product from idea to implementation.
        </p>

        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}

        <div className="mt-8 flex justify-center gap-3">
          <button
            onClick={() => setMode("create")}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            New Project
          </button>
          <button
            onClick={handleOpenExisting}
            disabled={isLoading}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {isLoading ? "Opening..." : "Open Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
