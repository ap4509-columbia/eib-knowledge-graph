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
  /** When the Predictions tab is active, this overlays a visual split of
   *  the rolling-window training months vs the prediction month on the
   *  timeline. Not passed on other tabs, so the timeline stays plain. */
  predictionsContext?: {
    /** The month whose predictions are being shown (usually monthTo). */
    predictionMonth: string;
    /** Rolling-window size — the model uses this many months preceding
     *  predictionMonth as training data. */
    trainingWindow: number;
  };
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
  predictionsContext,
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

  // Predictions-tab overlay: compute training window + prediction month
  // percentage positions on the timeline. WINDOW_SIZE mirrors the GAT
  // rolling-window trainer (train on [t-W, t-1], predict t).
  let predictionBand: { trainStartPct: number; trainEndPct: number; predPct: number; label: string } | null = null;
  if (predictionsContext) {
    const predIdx = allMonths.indexOf(predictionsContext.predictionMonth);
    if (predIdx > 0) {
      const trainStart = Math.max(0, predIdx - predictionsContext.trainingWindow);
      const trainEnd = predIdx - 1;
      const bandOffset = total > 1 ? 100 / (total - 1) / 2 : 0;
      predictionBand = {
        trainStartPct: Math.max(0, pct(trainStart) - bandOffset),
        trainEndPct: pct(trainEnd) + bandOffset,
        predPct: pct(predIdx),
        label:
          trainEnd >= trainStart
            ? `train ${allMonths[trainStart]}–${allMonths[trainEnd]} · predict ${predictionsContext.predictionMonth}`
            : `predict ${predictionsContext.predictionMonth}`,
      };
    }
  }

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
      {/* Label row: date chip pinned left, preset chips pinned right, with a
          gap between them so the chip can never overlap the presets even at
          the far edges of the range. min-w-0 lets the chip truncate rather
          than push into the preset zone if the corpus/format ever grows. */}
      <div className="mb-2 flex h-6 items-start gap-3">
        <div className="min-w-0 shrink">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums shadow-sm",
              touchesFuture
                ? "border-border bg-muted text-foreground"
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
              <span className="rounded-sm bg-muted-foreground/20 px-1 text-[8px] uppercase tracking-wider">
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

      {/* Predictions-tab overlay: shows the training window + prediction
          month above the timeline. Rendered only when predictionsContext
          is passed by page.tsx (i.e. Predictions tab active). */}
      {predictionBand && (
        <div className="mb-1.5 select-none">
          <div className="relative h-3">
            {/* Training band */}
            <div
              className="absolute top-0 h-full rounded-l-sm border-y border-l border-amber-600/40 bg-amber-500/15 dark:border-amber-500/40 dark:bg-amber-400/10"
              style={{
                left: `${predictionBand.trainStartPct}%`,
                width: `${Math.max(0, predictionBand.trainEndPct - predictionBand.trainStartPct)}%`,
              }}
              title={`Training window: ${allMonths[Math.max(0, allMonths.indexOf(predictionsContext!.predictionMonth) - predictionsContext!.trainingWindow)]} through ${allMonths[allMonths.indexOf(predictionsContext!.predictionMonth) - 1]}`}
            />
            {/* Prediction month marker — a thin vertical line + fill */}
            <div
              className="absolute top-0 h-full rounded-r-sm border-y border-r border-emerald-700/50 bg-emerald-600/25 dark:border-emerald-500/50 dark:bg-emerald-400/20"
              style={{
                left: `${predictionBand.trainEndPct}%`,
                width: `${Math.max(1.5, (100 / Math.max(1, total - 1)))}%`,
              }}
              title={`Prediction month: ${predictionsContext!.predictionMonth}`}
            />
          </div>
          <div className="mt-0.5 flex items-center gap-3 font-mono text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm border border-amber-600/40 bg-amber-500/25 dark:border-amber-500/40 dark:bg-amber-400/20" />
              trained on the {predictionsContext!.trainingWindow} months before
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm border border-emerald-700/50 bg-emerald-600/40 dark:border-emerald-500/50 dark:bg-emerald-400/30" />
              prediction month shown
            </span>
          </div>
        </div>
      )}

      {/* Timeline track + slider */}
      <div className="relative">
        {/* Future-zone backdrop — diagonal stripes to signal "beyond the data" */}
        {futureMonths.length > 0 && (
          <div
            className="pointer-events-none absolute -inset-y-3 z-0 rounded-sm bg-[length:6px_6px] bg-[linear-gradient(45deg,transparent_25%,rgba(120,120,120,0.10)_25%,rgba(120,120,120,0.10)_50%,transparent_50%,transparent_75%,rgba(120,120,120,0.10)_75%)]"
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
                    ? "bg-muted-foreground/50"
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
              className="absolute font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
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
