import { useEffect, useState, useCallback, useRef } from "react";
import {
  listWireframes,
  readWireframe,
  chooseWireframe,
  type WireframeManifest,
  type WireframeOption,
} from "../lib/tauri";
import { useProjectStore } from "../stores/project-store";
import { useAgentStore } from "../stores/agent-store";
import { useInspectorMessages } from "../hooks/use-inspector-messages";
import { injectInspectorScript } from "../lib/inspector-script";
import { InspectToggle } from "./inspect-toggle";

interface WireframePreviewProps {
  featureId: string;
  onLoadStatus?: (hasWireframes: boolean) => void;
  onChosenStatus?: (isChosen: boolean) => void;
}

export function WireframePreview({ featureId, onLoadStatus, onChosenStatus }: WireframePreviewProps) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const fileWriteVersion = useProjectStore((s) => s.fileWriteVersion);
  const [manifest, setManifest] = useState<WireframeManifest | null>(null);
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const [activeVariantFile, setActiveVariantFile] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHtml, setLoadingHtml] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useInspectorMessages(iframeRef, "wireframe", featureId);

  // Load manifest (re-fetches when files are written via MCP approval)
  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    listWireframes(projectPath, featureId)
      .then((m) => {
        setManifest(m);
        // Auto-select: chosen option, or first available
        const chosenOpt = m.options.find((o) => o.id === m.chosenOption);
        const initialOpt = chosenOpt ?? m.options[0] ?? null;
        if (initialOpt) {
          setActiveOptionId(initialOpt.id);
          setActiveVariantFile(initialOpt.variants[0]?.file ?? null);
        } else {
          setActiveOptionId(null);
          setActiveVariantFile(null);
        }
        onLoadStatus?.(m.options.length > 0);
        onChosenStatus?.(m.chosenOption !== null);
      })
      .catch(() => {
        setManifest(null);
        onLoadStatus?.(false);
        onChosenStatus?.(false);
      })
      .finally(() => setLoading(false));
  }, [projectPath, featureId, fileWriteVersion]);

  // Load HTML when active variant file changes
  useEffect(() => {
    if (!projectPath || !activeVariantFile) {
      setHtmlContent(null);
      return;
    }
    setLoadingHtml(true);
    readWireframe(projectPath, featureId, activeVariantFile)
      .then(setHtmlContent)
      .catch(() => setHtmlContent(null))
      .finally(() => setLoadingHtml(false));
  }, [projectPath, featureId, activeVariantFile]);

  const handleChoose = useCallback(async () => {
    if (!projectPath || !activeOptionId) return;
    try {
      const updated = await chooseWireframe(projectPath, featureId, activeOptionId);
      setManifest(updated);

      // Notify the agent about the chosen wireframe so it can build a prototype
      const chosenOption = updated.options.find((o) => o.id === activeOptionId);
      onChosenStatus?.(true);
      const contextKey = `feature:${featureId}:develop`;
      const message = `I've chosen wireframe "${chosenOption?.title ?? activeOptionId}". Please build a prototype based on it.`;
      await useAgentStore.getState().sendMessage(contextKey, projectPath, message);
    } catch (e) {
      console.error("Failed to choose wireframe:", e);
    }
  }, [projectPath, featureId, activeOptionId]);

  const selectOption = useCallback(
    (opt: WireframeOption) => {
      setActiveOptionId(opt.id);
      setActiveVariantFile(opt.variants[0]?.file ?? null);
    },
    [],
  );

  if (loading) {
    return (
      <div className="py-4">
        <p className="text-xs text-muted-foreground">Loading wireframes...</p>
      </div>
    );
  }

  if (!manifest || manifest.options.length === 0) {
    return null;
  }

  const activeOption = manifest.options.find((o) => o.id === activeOptionId);
  const isChosen = activeOption?.status === "chosen";
  const optionIndex = manifest.options.findIndex((o) => o.id === activeOptionId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Option tabs */}
      <div className="mb-2 flex items-center gap-1">
        {manifest.options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => selectOption(opt)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors ${
              opt.id === activeOptionId
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.status === "chosen" && (
              <svg
                className="h-3 w-3 text-green-400"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
            )}
            {opt.title}
          </button>
        ))}
      </div>

      {/* Variant pills (only if more than 1 variant) */}
      {activeOption && activeOption.variants.length > 1 && (
        <div className="mb-3 flex items-center gap-1.5">
          {activeOption.variants.map((v, i) => (
            <button
              key={v.file}
              onClick={() => setActiveVariantFile(v.file)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                v.file === activeVariantFile
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              title={v.description || v.label}
            >
              {optionIndex + 1}.{i + 1} {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Iframe preview */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-accent/30 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <InspectToggle />
            <span className="text-[11px] text-muted-foreground">
              {activeVariantFile}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isChosen && activeOption && (
              <button
                onClick={handleChoose}
                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Choose this wireframe
              </button>
            )}
            {isChosen && (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                chosen
              </span>
            )}
          </div>
        </div>

        {/* Iframe */}
        {loadingHtml ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">Loading preview...</p>
          </div>
        ) : htmlContent ? (
          <iframe
            ref={iframeRef}
            srcDoc={injectInspectorScript(htmlContent)}
            className="flex-1 w-full bg-white"
            sandbox="allow-scripts"
            title={`Wireframe: ${activeOption?.title ?? activeVariantFile}`}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">
              Failed to load wireframe
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
