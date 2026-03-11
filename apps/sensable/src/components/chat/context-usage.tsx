import type { AgentMessage, UsageData } from "../../stores/agent-store";

const MAX_CONTEXT_TOKENS = 200_000;

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

/**
 * Estimate context size from conversation history.
 *
 * The context includes system prompt + MCP tool defs + all messages + tool results.
 * We don't know the system prompt size so we count turns:
 * - Each user→assistant exchange adds roughly 5-15k tokens (message text + tool calls + results)
 * - Heavier tool-using turns add more
 */
function estimateFromMessages(messages: AgentMessage[]): { turns: number; estimate: number } {
  let turns = 0;
  let toolCallCount = 0;

  for (const msg of messages) {
    if (msg.role === "user") turns++;
    if (msg.toolCalls) toolCallCount += msg.toolCalls.length;
  }

  // Rough: each turn averages ~8k tokens (prompt overhead + message + tool calls & results)
  // Tool-heavy turns add more (each tool call ≈ 2k for input+result)
  const tokensPerTurn = 8_000;
  const tokensPerToolCall = 2_000;
  const estimate = turns * tokensPerTurn + toolCallCount * tokensPerToolCall;

  return { turns, estimate };
}

interface ContextUsageProps {
  usage: UsageData | null;
  messages: AgentMessage[];
}

export function ContextUsage({ usage, messages }: ContextUsageProps) {
  const { turns, estimate } = estimateFromMessages(messages);

  // Use CLI-reported input tokens if available, otherwise use turn-based estimate
  const contextTokens = (usage?.inputTokens && usage.inputTokens > 100)
    ? usage.inputTokens
    : estimate;

  if (turns === 0) return null;

  const percent = Math.min((contextTokens / MAX_CONTEXT_TOKENS) * 100, 100);

  const color =
    percent >= 80
      ? "bg-red-500"
      : percent >= 60
        ? "bg-yellow-500"
        : "bg-blue-500";

  const textColor =
    percent >= 80
      ? "text-red-400"
      : percent >= 60
        ? "text-yellow-400"
        : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2" title={buildTooltip(turns, contextTokens, usage)}>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={`text-[10px] tabular-nums ${textColor}`}>
          ~{formatTokens(contextTokens)}
        </span>
      </div>
      {usage?.totalCostUsd != null && (
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          ${usage.totalCostUsd.toFixed(3)}
        </span>
      )}
    </div>
  );
}

function buildTooltip(turns: number, contextTokens: number, usage: UsageData | null): string {
  const percent = ((contextTokens / MAX_CONTEXT_TOKENS) * 100).toFixed(0);
  const lines = [
    `~${formatTokens(contextTokens)} / ${formatTokens(MAX_CONTEXT_TOKENS)} tokens (~${percent}%)`,
    `${turns} turn${turns !== 1 ? "s" : ""} in this session`,
    "(estimated — actual depends on system prompt size)",
  ];
  if (usage?.totalCostUsd != null) lines.push(`Cost: $${usage.totalCostUsd.toFixed(4)}`);
  if (Number(percent) >= 80) lines.push("Consider starting a new session");
  return lines.join("\n");
}
