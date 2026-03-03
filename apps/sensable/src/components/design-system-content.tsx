import { useEffect, useState, useCallback } from "react";
import type { DesignSystemComponent, DesignSystemLayout } from "@sensable/schemas";
import { useProjectStore } from "../stores/project-store";
import {
  readDesignSystemTokens,
  syncDesignSystem,
  getPrototypeServerStatus,
  setupPrototypeServer,
  startPrototypeServer,
  stopPrototypeServer,
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

      {/* Tab content — scrollable area */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        {activeTab === "tokens" && <TokensViewer />}
        {activeTab === "components" && (
          <GalleryViewer items={components} type="components" />
        )}
        {activeTab === "layouts" && (
          <GalleryViewer items={layouts} type="layouts" />
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
    <div className="space-y-8 p-6">
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

function GalleryViewer({
  items,
  type,
}: {
  items: DesignSystemComponent[] | DesignSystemLayout[];
  type: "components" | "layouts";
}) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const project = useProjectStore((s) => s.project);
  const [status, setStatus] = useState<PrototypeServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop");

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

  // Empty state
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

  const selectedItem = items.find((item) => item.id === selectedId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Item list */}
      <div className="w-56 shrink-0 overflow-auto border-r border-border">
        <div className="p-2 space-y-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setIframeKey((k) => k + 1);
              }}
              className={`flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors ${
                selectedId === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <span className="text-sm font-medium">{item.name}</span>
              {"category" in item && (
                <span className="text-[10px] text-muted-foreground">
                  {(item as DesignSystemComponent).category}
                </span>
              )}
              {item.description && (
                <span className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {item.description}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Preview area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedItem ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Select a {type === "components" ? "component" : "layout"} to preview
            </p>
          </div>
        ) : !selectedItem.hasExample ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No preview available. Ask the agent to create an example file for {selectedItem.name}.
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">
              Checking prototype server...
            </p>
          </div>
        ) : !status?.setup ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Set up the prototype server to preview {type}.
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
        ) : !status.running ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Start the dev server to preview {type}.
              </p>
              <button
                onClick={handleStart}
                disabled={starting}
                className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {starting ? "Starting..." : "Start Server"}
              </button>
            </div>
          </div>
        ) : (
          <PreviewFrame
            url={`http://localhost:${status.port}/design-system/${type}/${selectedItem.id}/`}
            title={selectedItem.name}
            iframeKey={iframeKey}
            deviceSize={deviceSize}
            onDeviceSizeChange={setDeviceSize}
            onRefresh={() => setIframeKey((k) => k + 1)}
            onStop={handleStop}
            port={status.port}
          />
        )}
      </div>
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
  port,
}: {
  url: string;
  title: string;
  iframeKey: number;
  deviceSize: DeviceSize;
  onDeviceSizeChange: (size: DeviceSize) => void;
  onRefresh: () => void;
  onStop: () => void;
  port: number;
}) {
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
        </div>

        <div className="flex items-center gap-2">
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

      {/* Iframe */}
      <div className="flex flex-1 justify-center overflow-auto bg-accent/10">
        <iframe
          key={iframeKey}
          src={url}
          style={{ width: deviceWidths[deviceSize] }}
          className="h-full min-h-[400px] bg-white"
          title={`Preview: ${title}`}
        />
      </div>
    </div>
  );
}
