"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileSearch, Loader2, X } from "lucide-react";

import { PromptInput } from "@/components/ui/prompt-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { searchArticles, type ArticleResult } from "@/lib/api/client";
import { MONTH_NAMES, formatMonth } from "@/lib/months";
import { cn } from "@/lib/utils";

function formatDate(d: string): string {
  // "2024-02-15" → "Feb 15, 2024"
  const [y, mo, day] = d.split("-").map(Number);
  if (!y || !mo || !day) return d;
  return `${MONTH_NAMES[mo - 1]} ${day}, ${y}`;
}

type Preset = "current" | "3m" | "6m" | "all";
const PRESETS: { kind: Preset; label: string }[] = [
  { kind: "current", label: "This month" },
  { kind: "3m", label: "Last 3" },
  { kind: "6m", label: "Last 6" },
  { kind: "all", label: "All" },
];

const SUGGESTED_QUERIES = [
  "NVDA earnings",
  "AMD chip competition",
  "TSMC capacity",
  "Inflation rate hike",
];

export interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  months: string[];
  /** Start of the range the graph is showing. */
  monthFrom: string | null;
  /** End of that range; equal to monthFrom when a single month is selected. */
  monthTo: string | null;
  focusedEntity: string | null;
}

export function ChatPanel({
  open,
  onOpenChange,
  months,
  monthFrom: graphMonthFrom,
  monthTo: graphMonthTo,
  focusedEntity,
}: ChatPanelProps) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [results, setResults] = useState<ArticleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Range picker — follows whatever range the graph is showing, but stays
  // independently adjustable once the panel is open.
  const [monthFrom, setMonthFrom] = useState<string | null>(graphMonthFrom);
  const [monthTo, setMonthTo] = useState<string | null>(graphMonthTo);
  useEffect(() => {
    setMonthFrom(graphMonthFrom);
    setMonthTo(graphMonthTo);
  }, [graphMonthFrom, graphMonthTo]);

  useEffect(() => {
    if (monthFrom && monthTo && monthFrom > monthTo) setMonthFrom(monthTo);
  }, [monthFrom, monthTo]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || searching) return;
      setSearching(true);
      setError(null);
      setLastQuery(text);
      setQuery("");
      try {
        const res = await searchArticles({
          query: text,
          month_from: monthFrom ?? undefined,
          month_to: monthTo ?? undefined,
          focused_entity: focusedEntity ?? undefined,
        });
        setResults(res.results);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [monthFrom, monthTo, focusedEntity, searching]
  );

  return (
    <aside
      aria-hidden={!open}
      aria-label="Find articles in the source data"
      className={cn(
        "fixed right-0 top-0 bottom-[8.5rem] z-40 flex w-full sm:max-w-md flex-col",
        "border-l border-border bg-background text-foreground shadow-2xl shadow-black/30 dark:shadow-black/60",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-2">
          <FileSearch className="h-4 w-4 shrink-0 text-purple-500 dark:text-purple-400" />
          <h2 className="text-sm font-semibold tracking-tight">
            Find articles
          </h2>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Range picker */}
      {months.length > 0 && (() => {
        const fromIdx = monthFrom
          ? Math.max(0, months.indexOf(monthFrom))
          : 0;
        const toIdx = monthTo
          ? Math.max(0, months.indexOf(monthTo))
          : months.length - 1;
        const anchor = graphMonthTo ?? months[months.length - 1];
        const anchorIdx = months.indexOf(anchor);
        const span = toIdx - fromIdx + 1;

        const activePreset: Preset | null =
          fromIdx === 0 && toIdx === months.length - 1
            ? "all"
            : toIdx === anchorIdx && span === 1
              ? "current"
              : toIdx === anchorIdx && span === 3
                ? "3m"
                : toIdx === anchorIdx && span === 6
                  ? "6m"
                  : null;

        const apply = (p: Preset) => {
          if (p === "all") {
            setMonthFrom(months[0]);
            setMonthTo(months[months.length - 1]);
          } else if (p === "current") {
            setMonthFrom(anchor);
            setMonthTo(anchor);
          } else {
            const n = p === "3m" ? 3 : 6;
            setMonthFrom(months[Math.max(0, anchorIdx - (n - 1))]);
            setMonthTo(anchor);
          }
        };

        const sameMonth = monthFrom === monthTo;

        return (
          <div className="shrink-0 space-y-2 border-b border-border px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Range
                </span>
                <span className="truncate font-mono text-xs tabular-nums text-foreground">
                  {sameMonth ? (
                    formatMonth(monthFrom)
                  ) : (
                    <>
                      {formatMonth(monthFrom)}
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      {formatMonth(monthTo)}
                    </>
                  )}
                  <span className="ml-1.5 text-muted-foreground">
                    ({span} {span === 1 ? "month" : "months"})
                  </span>
                </span>
              </div>
              {focusedEntity && (
                <Badge
                  variant="secondary"
                  className="shrink-0 border border-border bg-muted font-mono text-[10px] text-muted-foreground"
                >
                  {focusedEntity}
                </Badge>
              )}
            </div>

            {months.length > 1 && (
              <div className="px-1 pt-1">
                <Slider
                  min={0}
                  max={months.length - 1}
                  step={1}
                  value={[fromIdx, toIdx]}
                  onValueChange={(v) => {
                    const arr = Array.isArray(v) ? v : [v];
                    if (arr.length < 2) return;
                    const a = Math.min(arr[0], arr[1]);
                    const b = Math.max(arr[0], arr[1]);
                    setMonthFrom(months[a]);
                    setMonthTo(months[b]);
                  }}
                />
                <div className="mt-1 flex justify-between font-mono text-[9px] tabular-nums text-muted-foreground">
                  <span>{months[0]?.slice(0, 4)}</span>
                  <span>{months[months.length - 1]?.slice(0, 4)}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => {
                const active = activePreset === p.kind;
                return (
                  <button
                    key={p.kind}
                    type="button"
                    onClick={() => apply(p.kind)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[10px] font-medium transition",
                      active
                        ? "border-foreground/40 bg-foreground/10 text-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Results */}
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="px-5 py-4">
          {searching && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!searching && error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {!searching && !error && results.length === 0 && !lastQuery && (
            <div className="py-6 text-center">
              <p className="mb-4 text-xs text-muted-foreground">
                Search the underlying news corpus by keyword. Results are
                filtered by the date range above (and the focused entity, if
                any).
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSubmit(q)}
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs transition hover:bg-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!searching && !error && results.length === 0 && lastQuery && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No articles matched <span className="font-medium text-foreground">&ldquo;{lastQuery}&rdquo;</span>{" "}
              in this range.
              <br />
              Try widening the range or different keywords.
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="space-y-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {results.length} article{results.length === 1 ? "" : "s"}
                {lastQuery && (
                  <>
                    {" "}for <span className="text-foreground">&ldquo;{lastQuery}&rdquo;</span>
                  </>
                )}
              </p>
              {results.map((r, i) => (
                <ArticleCard key={`${r.url}-${i}`} article={r} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Search input */}
      <div className="shrink-0 border-t border-border p-4">
        <PromptInput
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          disabled={searching}
          placeholder="Search articles (e.g. NVDA earnings)…"
        />
      </div>
    </aside>
  );
}

function ArticleCard({ article }: { article: ArticleResult }) {
  const card = (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 transition group-hover:border-foreground/30 group-hover:bg-accent/50">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-sm font-medium leading-snug text-foreground">
          {article.title}
        </h3>
        {article.url && (
          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
        )}
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span className="tabular-nums">{formatDate(article.date)}</span>
        {article.ticker && (
          <>
            <span className="opacity-50">·</span>
            <span className="rounded bg-muted px-1 py-0.5 font-semibold uppercase">
              {article.ticker}
            </span>
          </>
        )}
      </div>
      {article.summary && (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {article.summary}
        </p>
      )}
    </div>
  );

  if (article.url) {
    return (
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block"
      >
        {card}
      </a>
    );
  }
  return <div className="group">{card}</div>;
}
