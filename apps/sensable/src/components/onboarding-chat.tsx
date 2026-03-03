import { useRef, useEffect } from "react";
import { useAgentStore, deriveContextKey, getSessionState } from "../stores/agent-store";
import { useProjectStore } from "../stores/project-store";
import { MessageBubble } from "./chat/message-bubble";
import { StatusBadge } from "./chat/status-badge";
import { ChatInput } from "./chat/chat-input";
import { ThinkingIndicator } from "./chat/thinking-indicator";

const stepLabels = ["Project Spec", "Design System"] as const;

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-3">
      {stepLabels.map((label, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-8 ${isDone ? "bg-primary" : "bg-border"}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isDone
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? "\u2713" : i + 1}
              </div>
              <span
                className={`text-xs ${
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OnboardingChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string | undefined>(undefined);

  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const contextKey = deriveContextKey(project);

  const session = useAgentStore((s) => getSessionState(s.sessions, contextKey));
  const { messages, status, error } = session;
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const resetSession = useAgentStore((s) => s.resetSession);

  const onboardingStatus = project?.onboarding?.status ?? "project-spec";
  const currentStep = onboardingStatus === "project-spec" ? 0 : 1;
  const isBusy = status === "thinking" || status === "starting";
  const lastMsg = messages[messages.length - 1];
  const lastBlock = lastMsg?.isStreaming ? lastMsg.blocks[lastMsg.blocks.length - 1] : undefined;
  const showThinking = status === "thinking" && !(lastBlock?.type === "text" && lastBlock.content.length > 0);

  // Reset agent when onboarding step changes
  useEffect(() => {
    if (
      prevStatusRef.current !== undefined &&
      prevStatusRef.current !== onboardingStatus
    ) {
      resetSession(contextKey);
    }
    prevStatusRef.current = onboardingStatus;
  }, [onboardingStatus, resetSession, contextKey]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const welcomeMessages: Record<string, string> = {
    "project-spec":
      "Welcome! Let's start by defining your project. Send a message to begin describing what you're building.",
    "design-system":
      "Great, your project spec is ready! Now let's set up your design system. Describe the look and feel you're going for.",
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-hidden">
      <div className="flex w-full max-w-2xl min-h-0 flex-1 flex-col overflow-hidden">
        {/* Step indicator */}
        <div className="flex justify-center border-b border-border py-4">
          <StepIndicator currentStep={currentStep} />
        </div>

        {/* Messages */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-lg bg-muted/50 px-6 py-4">
                <p className="text-sm text-muted-foreground">
                  {welcomeMessages[onboardingStatus]}
                </p>
              </div>
              <StatusBadge status={status} />
            </div>
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

        {/* Input */}
        <div className="border-t border-border p-4">
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
            placeholder="Describe your project..."
          />
        </div>
      </div>
    </div>
  );
}
