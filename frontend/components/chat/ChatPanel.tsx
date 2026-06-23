"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Sparkles, X } from "lucide-react";

import { PromptInput } from "@/components/ui/prompt-input";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { SettingsDialog } from "./SettingsDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { sendChat } from "@/lib/api/client";
import { getApiKey } from "@/lib/settings";
import { cn } from "@/lib/utils";

export interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string | null;
  focusedEntity: string | null;
}

const EMPTY_PROMPTS = [
  "What's the latest news about NVDA?",
  "Why did AMD stock drop?",
  "Who is competing with TSMC?",
  "Summarize the bullish events this month",
];

export function ChatPanel({
  open,
  onOpenChange,
  month,
  focusedEntity,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Refresh "has key" state when panel opens or settings close
  useEffect(() => {
    if (open || !settingsOpen) {
      setHasKey(!!getApiKey());
    }
  }, [open, settingsOpen]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!scrollRef.current) return;
    const viewport = scrollRef.current.querySelector(
      "[data-slot='scroll-area-viewport']"
    ) as HTMLElement | null;
    (viewport ?? scrollRef.current).scrollTop = (
      viewport ?? scrollRef.current
    ).scrollHeight;
  }, [messages]);

  // Close on Escape (but not while settings dialog is open)
  useEffect(() => {
    if (!open || settingsOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, settingsOpen, onOpenChange]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      // If no key configured, prompt for it first instead of failing
      if (!hasKey) {
        setSettingsOpen(true);
        return;
      }

      const userMessage: ChatMessage = { role: "user", content: text };
      const pendingMessage: ChatMessage = {
        role: "assistant",
        content: "",
        pending: true,
      };
      setMessages((prev) => [...prev, userMessage, pendingMessage]);
      setInput("");
      setSending(true);

      try {
        const res = await sendChat({
          query: text,
          month: month ?? undefined,
          focused_entity: focusedEntity ?? undefined,
        });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: res.answer,
            sources: res.sources,
          };
          return next;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: "",
            error: message.includes("503")
              ? "The backend rejected your key. Open Settings and double-check it."
              : `Something went wrong: ${message}`,
          };
          return next;
        });
      } finally {
        setSending(false);
      }
    },
    [month, focusedEntity, sending, hasKey]
  );

  return (
    <>
      <aside
        aria-hidden={!open}
        aria-label="Chat about the knowledge graph"
        className={cn(
          "fixed right-0 top-0 bottom-0 z-40 flex w-full sm:max-w-md flex-col",
          "border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/50",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-zinc-900 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
            <h2 className="text-sm font-semibold tracking-tight">
              Ask AI about the graph
            </h2>
            <span
              className={cn(
                "ml-1 inline-block h-1.5 w-1.5 rounded-full",
                hasKey ? "bg-emerald-400" : "bg-zinc-600"
              )}
              title={hasKey ? "AI configured" : "No API key set"}
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close chat"
              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Context strip */}
        {(month || focusedEntity) && (
          <div className="flex flex-wrap gap-1.5 px-5 py-2 border-b border-zinc-900 shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono mr-1 self-center">
              Context:
            </span>
            {month && (
              <Badge
                variant="secondary"
                className="font-mono text-[10px] bg-zinc-900 text-zinc-300 border border-zinc-800"
              >
                {month}
              </Badge>
            )}
            {focusedEntity && (
              <Badge
                variant="secondary"
                className="font-mono text-[10px] bg-zinc-900 text-zinc-300 border border-zinc-800"
              >
                {focusedEntity}
              </Badge>
            )}
          </div>
        )}

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1">
          <div className="px-5 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-10">
                {!hasKey && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="mb-5 inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/20 transition"
                  >
                    <Sparkles className="h-3 w-3" />
                    Connect AI to get started
                  </button>
                )}
                <p className="text-xs text-zinc-500 mb-4">
                  Try a question grounded in the news you&apos;re looking at.
                </p>
                <div className="flex flex-col gap-2">
                  {EMPTY_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSubmit(p)}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300 text-left hover:bg-zinc-900 hover:border-zinc-700 transition"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <MessageBubble key={i} message={m} />)
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t border-zinc-900 p-4 shrink-0">
          <PromptInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={sending}
            placeholder={
              sending
                ? "Waiting for response…"
                : hasKey
                  ? "Ask about the graph…"
                  : "Connect AI to start chatting…"
            }
          />
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
