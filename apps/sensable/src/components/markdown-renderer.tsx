import Markdown from "react-markdown";
import { MermaidDiagram } from "./mermaid-diagram";
import type { ComponentPropsWithoutRef } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function CodeBlock({ children, className, ...rest }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className || "");
  const language = match?.[1];

  if (language === "mermaid") {
    return <MermaidDiagram chart={String(children).trim()} />;
  }

  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div
      className={
        className ??
        "prose prose-sm prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      }
    >
      <Markdown components={{ code: CodeBlock }}>{content}</Markdown>
    </div>
  );
}
