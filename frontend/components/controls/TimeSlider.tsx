"use client";

import { Slider } from "@/components/ui/slider";
import { formatMonth } from "@/lib/months";
import { cn } from "@/lib/utils";

export interface TimeSliderProps {
  /** Months with actual data, in ascending order (e.g. ["2019-01", ...]). */
  months: string[];
  /** Months that extend past the dataset for predictions. */
  futureMonths: string[];
  /** Start of the selected range (inclusive). */
  monthFrom: string | null;
  /** End of the selected range (inclusive). Equal to monthFrom for one month. */
  monthTo: string | null;
  onChange: (from: string, to: string) => void;
}

type Preset = { label: string; span: number | "all"; title: string };

/** Trailing windows anchored on the range's right edge, plus "everything". */
const PRESETS: Preset[] = [
  { label: "1M", span: 1, title: "Single month" },
  { label: "3M", span: 3, title: "Trailing quarter" },
  { label: "6M", span: 6, title: "Trailing half-year" },
  { label: "12M", span: 12, title: "Trailing year" },
  { label: "All", span: "all", title: "Every month available" },
];

export function TimeSlider({
  months,
  futureMonths,
  monthFrom,
  monthTo,
  onChange,
}: TimeSliderProps) {
  const allMonths = [...months, ...futureMonths];
  const total = allMonths.length;

  if (total === 0) {
    return (
      <div className="border-t border-border px-6 py-4 font-mono text-xs text-muted-foreground">
        no months available
      </div>
    );
  }

  const clampIdx = (i: number) => Math.min(total - 1, Math.max(0, i));
  const fromIdx = clampIdx(monthFrom ? allMonths.indexOf(monthFrom) : 0);
  const toIdx = clampIdx(monthTo ? allMonths.indexOf(monthTo) : fromIdx);
  const span = toIdx - fromIdx + 1;
  const isSingle = span === 1;
  // The forecast styling keys on the range *reaching into* the future zone.
  const touchesFuture = toIdx >= months.length;

  const pct = (i: number) => (total > 1 ? (i / (total - 1)) * 100 : 0);
  const futureStartPct = total > 1 ? (months.length / (total - 1)) * 100 : 100;
  // Kept off the extremes so the centered label never hangs off the edge.
  const labelPct = Math.min(94, Math.max(6, (pct(fromIdx) + pct(toIdx)) / 2));

  const emit = (a: number, b: number) => {
    const lo = allMonths[clampIdx(Math.min(a, b))];
    const hi = allMonths[clampIdx(Math.max(a, b))];
    if (!lo || !hi) return;
    if (lo === monthFrom && hi === monthTo) return;
    onChange(lo, hi);
  };

  const applyPreset = (p: Preset) => {
    if (p.span === "all") {
      emit(0, total - 1);
      return;
    }
    // Anchor trailing windows on the current right edge so "3M" reads as
    // "the quarter ending where I'm already looking".
    emit(toIdx - (p.span - 1), toIdx);
  };

  const activePreset = PRESETS.find((p) =>
    p.span === "all"
      ? fromIdx === 0 && toIdx === total - 1
      : span === p.span && !(fromIdx === 0 && toIdx === total - 1)
  );

  // Year boundaries — one tick per January (or the first month if it's not Jan).
  const yearTicks: { year: string; idx: number }[] = [];
  let prevYear = "";
  allMonths.forEach((m, i) => {
    const y = m.slice(0, 4);
    if (y !== prevYear) {
      yearTicks.push({ year: y, idx: i });
      prevYear = y;
    }
  });

  return (
    <div className="border-t border-border bg-background/80 px-6 pb-3 pt-3 backdrop-blur">
      {/* Label row: a single month floats over its thumb (keeps the scrubber
          feel), a multi-month range reads as a static heading on the left so
          it can't collide with the preset chips. */}
      <div className="relative mb-2 flex h-6 items-start">
        <div
          className={cn(
            "top-0",
            isSingle
              ? "absolute -translate-x-1/2 transition-[left] duration-100"
              : "shrink-0"
          )}
          style={isSingle ? { left: `${labelPct}%` } : undefined}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums shadow-sm",
              touchesFuture
                ? "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                : "border-border bg-background text-foreground"
            )}
          >
            {isSingle ? (
              formatMonth(monthTo)
            ) : (
              <>
                {formatMonth(monthFrom)}
                <span className="text-muted-foreground">→</span>
                {formatMonth(monthTo)}
                <span className="font-normal text-muted-foreground">
                  ({span} months)
                </span>
              </>
            )}
            {touchesFuture && (
              <span className="rounded-sm bg-purple-500/20 px-1 text-[8px] uppercase tracking-wider">
                forecast
              </span>
            )}
          </span>
        </div>

        {/* Preset chips, pinned right so they never collide with the label */}
        <div className="ml-auto flex shrink-0 gap-1">
          {PRESETS.map((p) => {
            const active = activePreset === p;
            return (
              <button
                key={p.label}
                type="button"
                title={p.title}
                onClick={() => applyPreset(p)}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium transition",
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

      {/* Timeline track + slider */}
      <div className="relative">
        {/* Future-zone backdrop — diagonal stripes to signal "beyond the data" */}
        {futureMonths.length > 0 && (
          <div
            className="pointer-events-none absolute -inset-y-3 z-0 rounded-sm bg-[length:6px_6px] bg-[linear-gradient(45deg,transparent_25%,rgba(168,85,247,0.10)_25%,rgba(168,85,247,0.10)_50%,transparent_50%,transparent_75%,rgba(168,85,247,0.10)_75%)]"
            style={{
              left: `${futureStartPct}%`,
              right: 0,
            }}
            aria-hidden
          />
        )}

        <div className="relative z-10">
          <Slider
            min={0}
            max={total - 1}
            step={1}
            value={[fromIdx, toIdx]}
            aria-label="Selected month range"
            // "push" (the library default, stated here so it isn't accidental):
            // with the thumbs collapsed on one month, dragging forward carries
            // both and keeps the old single-month scrubbing feel, while
            // dragging back opens the range. The preset chips are the
            // guaranteed path to any span regardless of drag direction.
            thumbCollisionBehavior="push"
            onValueChange={(v) => {
              const arr = Array.isArray(v) ? v : [v];
              if (arr.length < 2) return;
              emit(arr[0], arr[1]);
            }}
          />
        </div>

        {/* Per-month tick marks below the track — in-range months read brighter */}
        <div className="pointer-events-none relative mt-1 h-2.5">
          {allMonths.map((m, i) => {
            const isJan = m.endsWith("-01");
            const isFutureTick = i >= months.length;
            const inRange = i >= fromIdx && i <= toIdx;
            return (
              <div
                key={m}
                className={cn(
                  "absolute top-0 w-px -translate-x-1/2",
                  isJan ? "h-2.5" : "h-1.5",
                  isFutureTick
                    ? "bg-purple-500/50"
                    : inRange
                      ? "bg-primary"
                      : isJan
                        ? "bg-muted-foreground/70"
                        : "bg-border"
                )}
                style={{ left: `${pct(i)}%` }}
              />
            );
          })}
        </div>

        {/* Year labels along the bottom */}
        <div className="relative mt-1 h-4">
          {yearTicks.map(({ year, idx }) => (
            <span
              key={year}
              className="absolute -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
              style={{ left: `${pct(idx)}%` }}
            >
              {year}
            </span>
          ))}
          {/* "forecast →" hint at the start of the future zone */}
          {futureMonths.length > 0 && (
            <span
              className="absolute font-mono text-[9px] uppercase tracking-wider text-purple-500/80"
              style={{ left: `${futureStartPct}%`, paddingLeft: 4 }}
              aria-hidden
            >
              forecast →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
