import { MarkdownRenderer } from "../markdown-renderer";
import type { AgentMessage, ContentBlock } from "../../stores/agent-store";

function TextBlockBubble({
  block,
  isLastBlock,
  isStreaming,
}: {
  block: ContentBlock;
  isLastBlock: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted text-foreground">
        <MarkdownRenderer content={block.content} />
        {isStreaming && isLastBlock && (
          <span className="inline-block h-3 w-1 animate-pulse bg-current opacity-70" />
        )}
      </div>
    </div>
  );
}

function ToolCallBubble({ block }: { block: ContentBlock }) {
  const displayName = (block.toolName ?? "").replace(/^mcp__sensable__/, "");
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/50 px-2 py-1 text-[11px] text-muted-foreground">
        <span className="text-[10px] opacity-60">&#9881;</span>
        {displayName}
      </div>
    </div>
  );
}

export function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground">
          {message.images && message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt="Attached"
                  className="max-h-48 rounded-md border border-border/30 object-contain"
                />
              ))}
            </div>
          )}
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
      </div>
    );
  }

  // Assistant messages: render each block as its own bubble
  const blocks =
    message.blocks.length > 0
      ? message.blocks
      : // Fallback for messages without blocks (e.g. from completeMessage reconciliation)
        message.content
        ? [{ type: "text" as const, content: message.content }]
        : [];

  return (
    <>
      {blocks.map((block, i) => {
        const isLastBlock = i === blocks.length - 1;

        if (block.type === "text") {
          // Skip empty text blocks on completed messages
          if (block.content.length === 0 && !message.isStreaming) return null;
          return (
            <TextBlockBubble
              key={i}
              block={block}
              isLastBlock={isLastBlock}
              isStreaming={message.isStreaming}
            />
          );
        }

        if (block.type === "tool-call") {
          return <ToolCallBubble key={i} block={block} />;
        }

        return null;
      })}
      {/* Show cursor when streaming with no blocks yet */}
      {message.isStreaming && blocks.length === 0 && (
        <div className="flex justify-start">
          <div className="rounded-lg px-3 py-2 text-sm bg-muted text-foreground">
            <span className="inline-block h-3 w-1 animate-pulse bg-current opacity-70" />
          </div>
        </div>
      )}
    </>
  );
}
