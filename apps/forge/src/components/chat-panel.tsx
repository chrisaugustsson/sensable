import { useState, useRef, useEffect } from "react";
import { useWorkspaceStore, type ChatMessage } from "@/stores/workspace-store";

export function ChatPanel() {
  const { activeWorkspaceId, workspaces, addMessage } = useWorkspaceStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workspace?.messages.length]);

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Select or create a workspace to start</p>
      </div>
    );
  }

  const handleSend = () => {
    if (!input.trim() || !activeWorkspaceId) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };
    addMessage(activeWorkspaceId, message);
    setInput("");

    // TODO: Send to agent running in the worktree
    // For now, echo back a placeholder response
    setTimeout(() => {
      addMessage(activeWorkspaceId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Working in \`${workspace.worktreePath}\`...\n\n(Agent integration coming soon)`,
        timestamp: Date.now(),
      });
    }, 500);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium">{workspace.name}</h2>
        <p className="text-xs text-muted-foreground">{workspace.branch}</p>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
        {workspace.messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Start a conversation to begin working
          </p>
        ) : (
          <div className="space-y-4">
            {workspace.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the agent to do something..."
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
