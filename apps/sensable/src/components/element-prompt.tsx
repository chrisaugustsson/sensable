import { useState, useRef, type KeyboardEvent } from "react";
import { useInspectorStore } from "../stores/inspector-store";
import { useAgentStore, deriveContextKey } from "../stores/agent-store";
import { useProjectStore } from "../stores/project-store";

export function ElementPrompt() {
  const selectedElement = useInspectorStore((s) => s.selectedElement);
  const clear = useInspectorStore((s) => s.clear);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!selectedElement) return null;

  const handleSend = () => {
    const text = input.trim();
    if (!text || !projectPath || !project) return;

    const contextKey = deriveContextKey(project);
    const message = [
      "[Inspecting element]",
      `Tag: ${selectedElement.tag}`,
      `Selector: ${selectedElement.selector}`,
      `HTML: ${selectedElement.outerHTML}`,
      "",
      text,
    ].join("\n");

    sendMessage(contextKey, projectPath, message);
    setInput("");
    clear();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Compact outerHTML preview (first line, truncated)
  const preview = selectedElement.outerHTML.split("\n")[0].slice(0, 80);

  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 rounded-lg border border-blue-500/30 bg-background/95 p-2.5 shadow-lg backdrop-blur-sm">
      {/* Element info bar */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-blue-300">
          <span className="shrink-0 opacity-60">&#128269;</span>
          <span className="truncate">{preview}</span>
        </div>
        <button
          onClick={clear}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell the agent what to change..."
          rows={1}
          autoFocus
          className="flex-1 resize-none rounded-md border border-border bg-muted px-3 py-1.5 text-sm placeholder:text-muted-foreground"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="self-end rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
