import { useRef, useEffect } from "react";
import { useAgentStore, deriveContextKey, getSessionState, type AgentMessage } from "../stores/agent-store";
import { useProjectStore, useCurrentFeature } from "../stores/project-store";
import { MessageBubble } from "./chat/message-bubble";
import { StatusBadge } from "./chat/status-badge";
import { ChatInput } from "./chat/chat-input";
import { ThinkingIndicator } from "./chat/thinking-indicator";

function hasActiveTextStreaming(messages: AgentMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || !last.isStreaming) return false;
  const lastBlock = last.blocks[last.blocks.length - 1];
  return lastBlock?.type === "text" && lastBlock.content.length > 0;
}

function useContextLabel(): string | null {
  const project = useProjectStore((s) => s.project);
  const feature = useCurrentFeature();
  if (!project) return null;
  const view = project.currentView;
  if (view.type === "feature" && feature) {
    const phase = view.phase.charAt(0).toUpperCase() + view.phase.slice(1);
    return `${feature.name} — ${phase}`;
  }
  const appLabels: Record<string, string> = {
    overview: "Overview",
    architect: "Architecture",
    "design-system": "Design System",
    build: "Build",
    project: "Project",
  };
  if (view.type === "app") return appLabels[view.view] ?? view.view;
  return null;
}

export function AgentPanel() {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const contextKey = deriveContextKey(project);
  const contextLabel = useContextLabel();

  const session = useAgentStore((s) => getSessionState(s.sessions, contextKey));
  const { messages, status, error } = session;
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const resetSession = useAgentStore((s) => s.resetSession);
  const autoAcceptRules = useAgentStore((s) => s.autoAcceptRules);
  const clearAutoAcceptRules = useAgentStore((s) => s.clearAutoAcceptRules);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isBusy = status === "thinking" || status === "starting";
  const showThinking = status === "thinking" && !hasActiveTextStreaming(messages);

  return (
    <aside className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground shrink-0">
            Agent
          </p>
          {contextLabel && (
            <span className="text-[10px] text-muted-foreground/60 truncate">
              {contextLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {autoAcceptRules.size > 0 && (
            <button
              type="button"
              onClick={clearAutoAcceptRules}
              className="rounded px-1.5 py-0.5 text-[10px] text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20"
              title={`Auto-approving: ${[...autoAcceptRules].map((r) => r.replace(/^mcp__sensable__/, "")).join(", ")}`}
            >
              Auto-approve ({autoAcceptRules.size})
            </button>
          )}
          {status !== "offline" && (
            <button
              type="button"
              onClick={() => resetSession(contextKey)}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              New session
            </button>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {projectPath
              ? "Ask the agent about your project."
              : "Open a project to start a conversation."}
          </p>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {showThinking && <ThinkingIndicator />}

        {error && (
          <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-3">
        <ChatInput
          onSubmit={(msg, images) =>
            projectPath &&
            sendMessage(
              contextKey,
              projectPath,
              msg,
              images?.map((img) => ({ base64: img.base64, mediaType: img.mediaType })),
            )
          }
          onStop={() => stopAgent(contextKey)}
          disabled={!projectPath}
          isBusy={isBusy}
          placeholder={projectPath ? "Ask the agent..." : "Open a project first"}
        />
      </div>
    </aside>
  );
}
