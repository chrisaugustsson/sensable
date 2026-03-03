import { useState, useRef, useCallback, type KeyboardEvent, type ClipboardEvent, type FormEvent } from "react";

export interface PastedImage {
  id: string;
  base64: string;
  mediaType: string;
}

interface ChatInputProps {
  onSubmit: (message: string, images?: PastedImage[]) => void;
  onStop: () => void;
  disabled: boolean;
  isBusy: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSubmit,
  onStop,
  disabled,
  isBusy,
  placeholder = "Ask the agent...",
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PastedImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && !isBusy && (input.trim().length > 0 || images.length > 0);

  const resetTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    onSubmit(input.trim(), images.length > 0 ? images : undefined);
    setInput("");
    setImages([]);
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // result is "data:image/png;base64,iVBOR..."
          const base64 = result.split(",")[1];
          const mediaType = item.type;

          setImages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), base64, mediaType },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative">
              <img
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt="Pasted"
                className="h-16 w-16 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          ref={textareaRef}
          placeholder={placeholder}
          disabled={disabled}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            resetTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          className="flex-1 resize-none rounded-md border border-border bg-muted px-3 py-1.5 text-sm placeholder:text-muted-foreground disabled:opacity-50"
        />
        {isBusy ? (
          <button
            type="button"
            onClick={onStop}
            className="self-end rounded-md bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/30"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="self-end rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
