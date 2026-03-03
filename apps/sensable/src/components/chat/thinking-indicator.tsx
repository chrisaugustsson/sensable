import { useState, useEffect } from "react";

const PHRASES = [
  "Thinking",
  "Pondering",
  "Chewing on it",
  "Noodling",
  "Mulling it over",
  "Cogitating",
  "Connecting dots",
  "Brewing ideas",
];

export function ThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(
    () => Math.floor(Math.random() * PHRASES.length),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % PHRASES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground">
        <span className="flex gap-0.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
        </span>
        <span className="text-xs">{PHRASES[phraseIndex]}</span>
      </div>
    </div>
  );
}
