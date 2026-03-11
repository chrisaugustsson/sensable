import { useEffect } from "react";
import { useInspectorStore } from "../stores/inspector-store";

/**
 * Bridges the inspector store with an iframe via postMessage.
 * Sends enable/disable commands to the iframe and listens for element-selected events.
 */
export function useInspectorMessages(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  previewType: "wireframe" | "prototype",
  featureId: string,
): void {
  const inspectMode = useInspectorStore((s) => s.inspectMode);
  const setSelectedElement = useInspectorStore((s) => s.setSelectedElement);

  // Send enable/disable to iframe when inspectMode changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    const msg = inspectMode ? "inspector-enable" : "inspector-disable";
    iframe.contentWindow.postMessage({ type: msg }, "*");
  }, [inspectMode, iframeRef]);

  // Re-send enable on iframe load (handles iframe reload while inspect is active)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      if (useInspectorStore.getState().inspectMode) {
        iframe.contentWindow?.postMessage({ type: "inspector-enable" }, "*");
      }
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [iframeRef]);

  // Listen for element-selected messages from iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Validate source is our iframe (not origin — srcDoc has null origin)
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== "element-selected") return;

      const el = event.data.element;
      if (!el) return;

      setSelectedElement({
        tag: el.tag,
        id: el.id,
        classes: el.classes,
        textContent: el.textContent,
        outerHTML: el.outerHTML,
        selector: el.selector,
        ancestors: el.ancestors,
        previewType,
        featureId,
      });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframeRef, previewType, featureId, setSelectedElement]);
}
