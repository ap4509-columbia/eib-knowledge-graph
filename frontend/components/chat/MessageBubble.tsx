"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatSource {
  title: string;
  ticker: string;
  date: string;
  url: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  pending?: boolean;
  error?: string;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.pending) {
    return (
      <div className="flex justify-start">
        <div className="rounded-2xl rounded-bl-md border border-border bg-muted/40 px-3.5 py-2 text-sm text-muted-foreground">
          <TypingDots />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-muted/40 px-3.5 py-2.5",
          "whitespace-pre-wrap break-words text-sm"
        )}
      >
        {message.error ? (
          <span className="text-destructive">{message.error}</span>
        ) : (
          message.content
        )}
      </div>

      {message.sources && message.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.sources.map((s, i) => (
            <a
              key={`${s.url}-${i}`}
              href={s.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title={`${s.title}\n${s.date} · ${s.ticker}`}
            >
              <span className="font-mono">{s.ticker || "—"}</span>
              <span className="opacity-60">·</span>
              <span className="max-w-[180px] truncate">{s.title}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
