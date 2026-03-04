import { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  chart: string;
}

let mermaidInitialized = false;

async function getMermaid() {
  const { default: mermaid } = await import("mermaid");
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      fontFamily: "inherit",
      securityLevel: "strict",
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${crypto.randomUUID()}`);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(idRef.current, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render diagram");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
        <p className="mb-1 text-xs font-medium text-red-400">Diagram error</p>
        <pre className="text-xs text-red-300/70 whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 flex justify-center overflow-x-auto [&_svg]:max-w-full"
    />
  );
}
