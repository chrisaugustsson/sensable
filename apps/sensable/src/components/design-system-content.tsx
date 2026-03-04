import { useEffect, useState, useCallback, useRef } from "react";
import type { DesignSystemComponent, DesignSystemLayout } from "@sensable/schemas";
import { useProjectStore } from "../stores/project-store";
import {
  readDesignSystemTokens,
  syncDesignSystem,
  deleteLayout,
  deleteComponent,
  getPrototypeServerStatus,
  setupPrototypeServer,
  startPrototypeServer,
  stopPrototypeServer,
  reinstallPrototypeServer,
  type PrototypeServerStatus,
} from "../lib/tauri";

type SubTab = "tokens" | "components" | "layouts";
type DeviceSize = "mobile" | "tablet" | "desktop";

const deviceWidths: Record<DeviceSize, string> = {
  mobile: "375px",
  tablet: "768px",
  desktop: "100%",
};

interface TokenEntry { name: string; value: string }

interface ParsedTokens {
  colors: TokenEntry[];
  typography: TokenEntry[];
  radii: TokenEntry[];
  shadows: TokenEntry[];
  spacing: TokenEntry[];
  other: TokenEntry[];
  /** Flat map of all token names to raw values, for resolving var() references */
  valueMap: Map<string, string>;
}

/** Resolve a token value by following var() references through the map (max 5 hops) */
function resolveTokenValue(value: string, valueMap: Map<string, string>): string {
  let resolved = value;
  for (let i = 0; i < 5; i++) {
    const match = resolved.match(/^var\(--([^)]+)\)$/);
    if (!match) break;
    const ref = valueMap.get(match[1]);
    if (!ref) break;
    resolved = ref;
  }
  return resolved;
}

const TYPOGRAPHY_PREFIXES = ["font", "text", "leading", "tracking"];
const SHADOW_PREFIX = "shadow";
const SPACING_PREFIXES = ["spacing", "space", "gap", "z-"];

function parseTokensCss(css: string): ParsedTokens {
  const result: ParsedTokens = { colors: [], typography: [], radii: [], shadows: [], spacing: [], other: [], valueMap: new Map() };
  const regex = /--([a-zA-Z0-9-]+)\s*:\s*(.+?)\s*;/g;
  let match;

  // First pass: build the full value map
  const entries: Array<{ name: string; value: string }> = [];
  while ((match = regex.exec(css)) !== null) {
    const name = match[1];
    const value = match[2];
    result.valueMap.set(name, value);
    entries.push({ name, value });
  }

  // Second pass: categorize using resolved values
  for (const { name, value } of entries) {
    const resolved = resolveTokenValue(value, result.valueMap);

    if (TYPOGRAPHY_PREFIXES.some((p) => name.startsWith(p))) {
      result.typography.push({ name, value });
    } else if (name.startsWith("radius")) {
      result.radii.push({ name, value });
    } else if (name.startsWith(SHADOW_PREFIX)) {
      result.shadows.push({ name, value });
    } else if (SPACING_PREFIXES.some((p) => name.startsWith(p))) {
      result.spacing.push({ name, value });
    } else if (name.startsWith("color") || isColorValue(resolved)) {
      result.colors.push({ name, value });
    } else {
      result.other.push({ name, value });
    }
  }

  return result;
}

function isColorValue(value: string): boolean {
  return (
    value.startsWith("#") ||
    value.startsWith("rgb") ||
    value.startsWith("hsl") ||
    value.startsWith("oklch") ||
    value.startsWith("oklab")
  );
}

export function DesignSystemContent() {
  const projectPath = useProjectStore((s) => s.projectPath);
  const project = useProjectStore((s) => s.project);
  const [activeTab, setActiveTab] = useState<SubTab>("tokens");

  // Sync design system metadata on mount
  useEffect(() => {
    if (!projectPath) return;
    syncDesignSystem(projectPath).catch(() => {});
  }, [projectPath]);

  const handleDeleteLayout = useCallback(async (id: string) => {
    if (!projectPath) return;
    const updated = await deleteLayout(projectPath, id);
    useProjectStore.setState({ project: updated });
  }, [projectPath]);

  const handleDeleteComponent = useCallback(async (id: string) => {
    if (!projectPath) return;
    const updated = await deleteComponent(projectPath, id);
    useProjectStore.setState({ project: updated });
  }, [projectPath]);

  const ds = project?.designSystem;
  const components = ds?.components ?? [];
  const layouts = ds?.layouts ?? [];

  const tabs: Array<{ id: SubTab; label: string; count?: number }> = [
    { id: "tokens", label: "Tokens" },
    { id: "components", label: "Components", count: components.length },
    { id: "layouts", label: "Layouts", count: layouts.length },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sub-tab navigation */}
      <div className="shrink-0 border-b border-border px-6">
        <div className="flex gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — flex container; each tab manages its own scrolling */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "tokens" && <TokensViewer />}
        {activeTab === "components" && (
          <CatalogViewer
            items={components}
            type="components"
            onDeleteItem={handleDeleteComponent}
          />
        )}
        {activeTab === "layouts" && (
          <CatalogViewer
            items={layouts}
            type="layouts"
            onDeleteItem={handleDeleteLayout}
          />
        )}
      </div>
    </div>
  );
}

function TokensViewer() {
  const projectPath = useProjectStore((s) => s.projectPath);
  const [tokens, setTokens] = useState<ParsedTokens | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    readDesignSystemTokens(projectPath)
      .then((css) => {
        if (css) {
          setTokens(parseTokensCss(css));
        } else {
          setTokens(null);
        }
      })
      .catch(() => setTokens(null))
      .finally(() => setLoading(false));
  }, [projectPath]);

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-xs text-muted-foreground">Loading tokens...</p>
      </div>
    );
  }

  const isEmpty = !tokens || [tokens.colors, tokens.typography, tokens.radii, tokens.shadows, tokens.spacing, tokens.other].every((a) => a.length === 0);
  if (isEmpty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          No design tokens defined yet. Ask the agent to help create your color palette, typography, and spacing tokens.
        </p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-auto space-y-8 p-6">
      {/* Colors */}
      {tokens.colors.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Colors
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tokens.colors.map((token) => {
              const resolved = resolveTokenValue(token.value, tokens.valueMap);
              return (
                <div key={token.name} className="rounded-lg border border-border p-3">
                  {isColorValue(resolved) ? (
                    <div
                      className="mb-2 h-12 rounded-md border border-border"
                      style={{ backgroundColor: resolved }}
                    />
                  ) : (
                    <div className="mb-2 flex h-12 items-center justify-center rounded-md border border-border bg-accent/30">
                      <span className="text-[10px] text-muted-foreground">ref</span>
                    </div>
                  )}
                  <p className="truncate text-xs font-medium">--{token.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{token.value}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Typography */}
      {tokens.typography.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Typography
          </h3>
          <div className="space-y-3">
            {tokens.typography.map((token: TokenEntry) => {
              const isFontFamily = token.name.includes("family");
              const isFontSize = token.name.includes("size") || token.name.startsWith("text-");
              const isFontWeight = token.name.includes("weight");

              return (
                <div
                  key={token.name}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      --{token.name}
                    </p>
                    <p
                      className="mt-1 truncate text-sm"
                      style={{
                        fontFamily: isFontFamily ? token.value : undefined,
                        fontSize: isFontSize ? token.value : undefined,
                        fontWeight: isFontWeight ? token.value : undefined,
                      }}
                    >
                      {isFontFamily ? "The quick brown fox jumps" : token.value}
                    </p>
                  </div>
                  {isFontFamily && (
                    <span className="ml-4 shrink-0 text-[11px] text-muted-foreground">
                      {token.value}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Border Radius */}
      {tokens.radii.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Border Radius
          </h3>
          <div className="flex flex-wrap gap-4">
            {tokens.radii.map((token) => (
              <div key={token.name} className="flex flex-col items-center gap-2">
                <div
                  className="h-16 w-16 border-2 border-foreground/20 bg-accent/50"
                  style={{ borderRadius: token.value }}
                />
                <div className="text-center">
                  <p className="text-xs font-medium">--{token.name}</p>
                  <p className="text-[11px] text-muted-foreground">{token.value}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Shadows */}
      {tokens.shadows.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Shadows
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {tokens.shadows.map((token) => (
              <div key={token.name} className="overflow-hidden rounded-lg border border-border p-3">
                <div
                  className="mb-2 h-12 rounded-md bg-background"
                  style={{ boxShadow: token.value }}
                />
                <p className="truncate text-xs font-medium">--{token.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{token.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Spacing / Z-Index */}
      {tokens.spacing.length > 0 && (
        <TokenTable label="Spacing & Z-Index" tokens={tokens.spacing} />
      )}

      {/* Other tokens */}
      {tokens.other.length > 0 && (
        <TokenTable label="Other Tokens" tokens={tokens.other} />
      )}
    </div>
  );
}

function TokenTable({ label, tokens }: { label: string; tokens: TokenEntry[] }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {tokens.map((token) => (
          <div
            key={token.name}
            className="flex min-w-0 items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <span className="truncate text-xs font-medium">--{token.name}</span>
            <span className="ml-2 truncate text-[11px] text-muted-foreground">
              {token.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CatalogViewer({
  items,
  type,
  onDeleteItem,
}: {
  items: DesignSystemComponent[] | DesignSystemLayout[];
  type: "components" | "layouts";
  onDeleteItem: (id: string) => Promise<void>;
}) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const project = useProjectStore((s) => s.project);
  const [status, setStatus] = useState<PrototypeServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop");
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [catalogContext, setCatalogContext] = useState<{
    view: "catalog" | "detail";
    selectedId: string | null;
  }>({ view: "catalog", selectedId: null });
  const manageRef = useRef<HTMLDivElement>(null);

  // Listen for catalog navigation events from iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "catalog-navigation") {
        setCatalogContext({
          view: e.data.view,
          selectedId: e.data.selectedId,
        });
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Close manage dropdown on click outside
  useEffect(() => {
    if (!manageOpen) return;
    const handler = (e: MouseEvent) => {
      if (manageRef.current && !manageRef.current.contains(e.target as Node)) {
        setManageOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [manageOpen]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    await onDeleteItem(confirmDelete.id);
    setConfirmDelete(null);
    setIframeKey((k) => k + 1);
  }, [confirmDelete, onDeleteItem]);

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

  const hasAnyExample = items.some((item) => item.hasExample);
  const typeLabel = type === "components" ? "components" : "layouts";

  // Empty state: no items at all
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          {type === "components"
            ? "No components yet. Ask the agent to create reusable components for your design system."
            : "No layouts yet. Ask the agent to create layout shells (sidebar, dashboard, etc.) that prototypes will use."}
        </p>
      </div>
    );
  }

  // Items exist but none have examples
  if (!hasAnyExample) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          {typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} exist but none have preview examples yet. Ask the agent to create example files.
        </p>
      </div>
    );
  }

  // Server checks
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Checking prototype server...</p>
      </div>
    );
  }

  if (!status?.setup) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Set up the prototype server to preview {typeLabel}.
          </p>
          <button
            onClick={handleSetup}
            disabled={settingUp}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {settingUp ? "Setting up..." : "Setup Prototype Server"}
          </button>
        </div>
      </div>
    );
  }

  if (!status.running) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Start the dev server to preview {typeLabel}.
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
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

  // Derive title from catalog navigation context
  const defaultTitle = type === "components" ? "Component Catalog" : "Layout Catalog";
  const catalogTitle =
    catalogContext.view === "detail" && catalogContext.selectedId
      ? (items.find((item) => item.id === catalogContext.selectedId)?.name ?? defaultTitle)
      : defaultTitle;

  const catalogUrl = `http://localhost:${status.port}/design-system/${type}-catalog/`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PreviewFrame
        url={catalogUrl}
        title={catalogTitle}
        iframeKey={iframeKey}
        deviceSize={deviceSize}
        onDeviceSizeChange={setDeviceSize}
        fitToHeight={catalogContext.view === "detail"}
        breadcrumb={catalogContext.view === "detail" ? catalogTitle : null}
        onBreadcrumbDelete={
          catalogContext.view === "detail" && catalogContext.selectedId
            ? () => {
                const item = items.find((i) => i.id === catalogContext.selectedId);
                if (item) setConfirmDelete({ id: item.id, name: item.name });
              }
            : undefined
        }
        onRefresh={() => setIframeKey((k) => k + 1)}
        onStop={handleStop}
        onReinstall={handleReinstall}
        reinstalling={reinstalling}
        port={status.port}
        manageButton={
          <div className="relative" ref={manageRef}>
            <button
              onClick={() => setManageOpen(!manageOpen)}
              className={`rounded-md border border-border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                manageOpen
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={`Manage ${typeLabel}`}
            >
              Manage
            </button>
            {manageOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 max-h-80 overflow-auto rounded-md border border-border bg-background shadow-lg">
                <div className="p-1">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center justify-between rounded-sm px-2 py-1 hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs">{item.name}</p>
                        {"category" in item && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {(item as DesignSystemComponent).category}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ id: item.id, name: item.name });
                        }}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                        title={`Delete ${type === "components" ? "component" : "layout"}`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
            <p className="text-sm font-medium">Delete &quot;{confirmDelete.name}&quot;?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This will permanently remove all associated files.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewFrame({
  url,
  title,
  iframeKey,
  deviceSize,
  onDeviceSizeChange,
  onRefresh,
  onStop,
  onReinstall,
  reinstalling,
  port,
  manageButton,
  fitToHeight = false,
  breadcrumb,
  onBreadcrumbDelete,
}: {
  url: string;
  title: string;
  iframeKey: number;
  deviceSize: DeviceSize;
  onDeviceSizeChange: (size: DeviceSize) => void;
  onRefresh: () => void;
  onStop: () => void;
  onReinstall: () => void;
  reinstalling: boolean;
  port: number;
  manageButton?: React.ReactNode;
  fitToHeight?: boolean;
  breadcrumb?: string | null;
  onBreadcrumbDelete?: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: "set-theme", theme: next },
      "*",
    );
  }, [theme]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-accent/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
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

          <div className="flex items-center gap-0.5 rounded-md bg-accent/50 p-0.5">
            {(["mobile", "tablet", "desktop"] as const).map((size) => (
              <button
                key={size}
                onClick={() => onDeviceSizeChange(size)}
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
          {manageButton}

          <a
            href={url}
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

          <button
            onClick={onReinstall}
            disabled={reinstalling}
            className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Reinstall dev server"
          >
            {reinstalling ? "Reinstalling..." : "Reinstall"}
          </button>

          <button
            onClick={onStop}
            className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
          >
            Stop
          </button>

          <span className="flex items-center gap-1 text-[10px] text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            :{port}
          </span>
        </div>
      </div>

      {/* Breadcrumb */}
      {breadcrumb && (
        <div className="flex items-center justify-between border-b border-border bg-accent/10 px-3 py-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                iframeRef.current?.contentWindow?.postMessage({ type: "navigate-catalog" }, "*");
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Catalog
            </button>
            <span className="text-[11px] text-muted-foreground">/</span>
            <span className="text-[11px] font-medium text-foreground">{breadcrumb}</span>
          </div>
          {onBreadcrumbDelete && (
            <button
              onClick={onBreadcrumbDelete}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
              title="Delete"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Iframe */}
      <div className={`flex flex-1 justify-center ${fitToHeight ? "overflow-hidden" : "overflow-auto"}`}>
        <iframe
          ref={iframeRef}
          key={iframeKey}
          src={url}
          style={{ width: deviceWidths[deviceSize] }}
          className={fitToHeight ? "h-full" : "h-full min-h-[400px]"}
          title={`Preview: ${title}`}
        />
      </div>
    </div>
  );
}
