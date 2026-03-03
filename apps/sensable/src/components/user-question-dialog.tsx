import { useState, type KeyboardEvent } from "react";
import type { PendingUserQuestion, UserQuestion } from "../stores/agent-store";

interface UserQuestionDialogProps {
  pendingQuestion: PendingUserQuestion;
  onAnswer: (answer: string) => void;
  onDismiss: () => void;
}

function SingleSelectBody({
  question,
  onAnswer,
}: {
  question: UserQuestion;
  onAnswer: (answer: string) => void;
}) {
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  const handleOtherKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && otherText.trim()) {
      onAnswer(otherText.trim());
    }
    if (e.key === "Escape") {
      setShowOther(false);
      setOtherText("");
    }
  };

  return (
    <div className="space-y-1.5">
      {question.options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onAnswer(opt.label)}
          className="w-full rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <p className="text-sm font-medium">{opt.label}</p>
          {opt.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {opt.description}
            </p>
          )}
        </button>
      ))}
      {showOther ? (
        <div className="flex gap-2 pt-1">
          <input
            autoFocus
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={handleOtherKeyDown}
            placeholder="Type your answer..."
            className="flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm placeholder:text-muted-foreground"
          />
          <button
            type="button"
            disabled={!otherText.trim()}
            onClick={() => otherText.trim() && onAnswer(otherText.trim())}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowOther(true)}
          className="w-full rounded-md border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
        >
          Other...
        </button>
      )}
    </div>
  );
}

function MultiSelectBody({
  question,
  onAnswer,
}: {
  question: UserQuestion;
  onAnswer: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  const toggle = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const answers = [...selected];
    if (showOther && otherText.trim()) {
      answers.push(otherText.trim());
    }
    if (answers.length > 0) {
      onAnswer(answers.join(", "));
    }
  };

  return (
    <div className="space-y-1.5">
      {question.options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => toggle(opt.label)}
          className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors ${
            selected.has(opt.label)
              ? "border-primary bg-primary/10"
              : "border-border hover:bg-muted/50"
          }`}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
              selected.has(opt.label)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40"
            }`}
          >
            {selected.has(opt.label) && "\u2713"}
          </span>
          <div>
            <p className="text-sm font-medium">{opt.label}</p>
            {opt.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {opt.description}
              </p>
            )}
          </div>
        </button>
      ))}
      {showOther ? (
        <div className="flex gap-2 pt-1">
          <input
            autoFocus
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Type your answer..."
            className="flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm placeholder:text-muted-foreground"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowOther(true)}
          className="w-full rounded-md border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
        >
          Other...
        </button>
      )}
      <button
        type="button"
        disabled={selected.size === 0 && !(showOther && otherText.trim())}
        onClick={handleConfirm}
        className="mt-2 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Confirm
      </button>
    </div>
  );
}

export function UserQuestionDialog({
  pendingQuestion,
  onAnswer,
  onDismiss,
}: UserQuestionDialogProps) {
  const question = pendingQuestion.questions[0];
  if (!question) return null;

  const hasOptions = question.options.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background text-foreground shadow-xl">
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          {question.header && (
            <p className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              {question.header}
            </p>
          )}
          <p className="text-sm font-medium">{question.question}</p>
        </div>

        {/* Body */}
        <div className="max-h-80 overflow-y-auto px-5 py-3">
          {hasOptions ? (
            question.multiSelect ? (
              <MultiSelectBody question={question} onAnswer={onAnswer} />
            ) : (
              <SingleSelectBody question={question} onAnswer={onAnswer} />
            )
          ) : (
            <FreeTextBody onAnswer={onAnswer} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/80"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function FreeTextBody({
  onAnswer,
}: {
  onAnswer: (answer: string) => void;
}) {
  const [text, setText] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && text.trim()) {
      onAnswer(text.trim());
    }
  };

  return (
    <div className="flex gap-2">
      <input
        autoFocus
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your answer..."
        className="flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm placeholder:text-muted-foreground"
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => text.trim() && onAnswer(text.trim())}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Send
      </button>
    </div>
  );
}
