"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { AILoader } from "@/components/ui/ai-loader";

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

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-800 px-3.5 py-2 text-sm text-zinc-100 whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.pending) {
    return (
      <div className="flex justify-start">
        <AILoader size={88} text="Thinking" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "max-w-[92%] rounded-2xl rounded-bl-md border border-zinc-800/70 bg-zinc-900/40 px-3.5 py-2.5",
          "text-sm text-zinc-100 whitespace-pre-wrap break-words"
        )}
      >
        {message.error ? (
          <span className="text-red-300">{message.error}</span>
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
              className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
              title={`${s.title}\n${s.date} · ${s.ticker}`}
            >
              <span className="font-mono">{s.ticker || "—"}</span>
              <span className="text-zinc-600">·</span>
              <span className="max-w-[180px] truncate">{s.title}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0 text-zinc-600" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
