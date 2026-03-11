import { useEffect, useState, useCallback, useRef } from "react";
import {
  getPrototypeServerStatus,
  setupPrototypeServer,
  startPrototypeServer,
  stopPrototypeServer,
  reinstallPrototypeServer,
  type PrototypeServerStatus,
} from "../lib/tauri";
import { useProjectStore } from "../stores/project-store";
import { useInspectorMessages } from "../hooks/use-inspector-messages";
import { InspectToggle } from "./inspect-toggle";

interface PrototypePreviewProps {
  featureId: string;
}

type DeviceSize = "mobile" | "tablet" | "desktop";

const deviceWidths: Record<DeviceSize, string> = {
  mobile: "375px",
  tablet: "768px",
  desktop: "100%",
};

export function PrototypePreview({ featureId }: PrototypePreviewProps) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const project = useProjectStore((s) => s.project);
  const [status, setStatus] = useState<PrototypeServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useInspectorMessages(iframeRef, "prototype", featureId);

  // Check server status on mount
  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    getPrototypeServerStatus(projectPath)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [projectPath]);

  const handleSetup = useCallback(async () => {
    if (!projectPath) return;
    setSettingUp(true);
    try {
      const framework = project?.framework ?? "react";
      await setupPrototypeServer(projectPath, framework);
      const newStatus = await getPrototypeServerStatus(projectPath);
      setStatus(newStatus);
    } catch (e) {
      console.error("Failed to setup prototype server:", e);
    } finally {
      setSettingUp(false);
    }
  }, [projectPath, project?.framework]);

  const handleStart = useCallback(async () => {
    if (!projectPath) return;
    setStarting(true);
    try {
      const result = await startPrototypeServer(projectPath);
      setStatus(result);
    } catch (e) {
      console.error("Failed to start prototype server:", e);
    } finally {
      setStarting(false);
    }
  }, [projectPath]);

  const handleStop = useCallback(async () => {
    if (!projectPath) return;
    try {
      await stopPrototypeServer();
      const newStatus = await getPrototypeServerStatus(projectPath);
      setStatus(newStatus);
    } catch (e) {
      console.error("Failed to stop prototype server:", e);
    }
  }, [projectPath]);

  const handleReinstall = useCallback(async () => {
    if (!projectPath) return;
    setReinstalling(true);
    try {
      const framework = project?.framework ?? "react";
      await reinstallPrototypeServer(projectPath, framework);
      const newStatus = await getPrototypeServerStatus(projectPath);
      setStatus(newStatus);
    } catch (e) {
      console.error("Failed to reinstall prototype server:", e);
    } finally {
      setReinstalling(false);
    }
  }, [projectPath, project?.framework]);

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: "set-theme", theme: next },
      "*",
    );
  }, [theme]);

  const handleIframeLoad = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "set-theme", theme },
      "*",
    );
  }, [theme]);

  if (loading) {
    return (
      <div className="py-4">
        <p className="text-xs text-muted-foreground">
          Checking prototype server...
        </p>
      </div>
    );
  }

  // Not set up yet
  if (!status?.setup) {
    return (
      <div className="rounded-lg border border-border p-6 text-center">
        <h3 className="text-sm font-semibold">Prototype Server</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Set up the prototype server to preview interactive prototypes.
        </p>
        <button
          onClick={handleSetup}
          disabled={settingUp}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {settingUp ? "Setting up..." : "Setup Prototype Server"}
        </button>
      </div>
    );
  }

  // Set up but not running
  if (!status.running) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border p-6 text-center">
          <h3 className="text-sm font-semibold">Prototype Server</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            Start the dev server to preview prototypes.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={handleStart}
              disabled={starting || reinstalling}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {starting ? "Starting..." : "Start Server"}
            </button>
            <button
              onClick={handleReinstall}
              disabled={starting || reinstalling}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {reinstalling ? "Reinstalling..." : "Reinstall"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Running — show iframe
  const iframeUrl = `http://localhost:${status.port}/features/${featureId}/`;

  return (
    <div className="flex flex-1 flex-col rounded-lg border border-border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-accent/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            onClick={handleRefresh}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Refresh"
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
              <path d="M1 1v4h4M15 15v-4h-4" />
              <path d="M13.5 6A6 6 0 0 0 3 3.5L1 5m12 7l-2 1.5A6 6 0 0 1 2.5 10" />
            </svg>
          </button>

          {/* Inspect element */}
          <InspectToggle />

          {/* Device size toggle */}
          <div className="flex items-center gap-0.5 rounded-md bg-accent/50 p-0.5">
            {(["mobile", "tablet", "desktop"] as const).map((size) => (
              <button
                key={size}
                onClick={() => setDeviceSize(size)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  deviceSize === size
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {size.charAt(0).toUpperCase() + size.slice(1)}
              </button>
            ))}
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 8.5A6 6 0 0 1 7.5 2 6 6 0 1 0 14 8.5Z" />
              </svg>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Open in browser */}
          <a
            href={iframeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Open in browser"
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
              <path d="M10 2h4v4M6 10l8-8M14 8.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h4.5" />
            </svg>
          </a>

          {/* Reinstall server */}
          <button
            onClick={handleReinstall}
            disabled={reinstalling}
            className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Reinstall dev server"
          >
            {reinstalling ? "Reinstalling..." : "Reinstall"}
          </button>

          {/* Stop server */}
          <button
            onClick={handleStop}
            className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
          >
            Stop
          </button>

          {/* Status indicator */}
          <span className="flex items-center gap-1 text-[10px] text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            :{status.port}
          </span>
        </div>
      </div>

      {/* Iframe */}
      <div className="flex flex-1 justify-center overflow-auto">
        <iframe
          ref={iframeRef}
          key={iframeKey}
          src={iframeUrl}
          onLoad={handleIframeLoad}
          style={{ width: deviceWidths[deviceSize] }}
          className="h-full min-h-0 flex-1 transition-[width] duration-300"
          title={`Prototype: ${featureId}`}
        />
      </div>
    </div>
  );
}
