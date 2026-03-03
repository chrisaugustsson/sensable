export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    offline: "bg-muted text-muted-foreground",
    starting: "bg-yellow-500/20 text-yellow-400",
    running: "bg-green-500/20 text-green-400",
    thinking: "bg-blue-500/20 text-blue-400",
    error: "bg-red-500/20 text-red-400",
  };

  const labels: Record<string, string> = {
    offline: "Offline",
    starting: "Starting...",
    running: "Ready",
    thinking: "Thinking...",
    error: "Error",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] ${colors[status] ?? colors.offline}`}
    >
      {labels[status] ?? "Offline"}
    </span>
  );
}
