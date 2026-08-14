"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
            {predictionsContext ? (
              <>
                <span className="font-normal text-muted-foreground">predicting</span>
                {formatMonth(monthTo)}
              </>
            ) : isSingle ? (
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

        {/* Preset chips, pinned right so they never collide with the label.
            Hidden on the Predictions tab — trailing 3M/6M/etc ranges don't
            make sense there; only a single prediction month is meaningful. */}
        {!predictionsContext && (
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
        )}
      </div>

      {/* Predictions-tab legend — the actual scrubber IS rendered below,
          replacing the range slider entirely. Legend just names what the
          two colours mean plus the exact months in the current window. */}
      {predictionBand && (() => {
        const predIdx = allMonths.indexOf(predictionsContext!.predictionMonth);
        const trainStartIdx = Math.max(0, predIdx - predictionsContext!.trainingWindow);
        const trainEndIdx = predIdx - 1;
        const trainStartMo = allMonths[trainStartIdx];
        const trainEndMo = allMonths[Math.max(trainStartIdx, trainEndIdx)];
        const predMo = predictionsContext!.predictionMonth;
        return (
          <div className="mb-2 flex select-none items-center gap-x-4 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm border border-amber-600/50 bg-amber-500/40 dark:border-amber-500/50 dark:bg-amber-400/30" />
              trained on <span className="text-foreground">{trainStartMo} → {trainEndMo}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm border border-emerald-700/60 bg-emerald-600/50 dark:border-emerald-500/60 dark:bg-emerald-400/40" />
              predicts <span className="text-foreground">{predMo}</span>
            </span>
            <span
              className="ml-auto text-muted-foreground/70"
              title={`Window size fixed at ${predictionsContext!.trainingWindow} training months per the rolling-window GAT (see scripts/compute_gat_predictions.py). Raw per-month prediction bundle: sources/fnspid-19-20-semis/predictions.json — hover to verify against the model.`}
            >
              drag the window · rolling size = {predictionsContext!.trainingWindow}
            </span>
          </div>
        );
      })()}

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
          {predictionsContext ? (
            <WindowScrubber
              total={total}
              allMonths={allMonths}
              trainingWindow={predictionsContext.trainingWindow}
              predictionMonthIdx={toIdx}
              onChange={(idx) => emit(idx, idx)}
            />
          ) : (
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
          )}
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


/**
 * A draggable 4-month "window" on the timeline for the Predictions tab.
 * Renders as amber (training) + emerald (prediction) blocks side-by-side.
 * The whole block is the interaction — no separate thumbs. Click anywhere
 * on the track to snap the window; drag the block to slide it; arrow keys
 * for one-month nudges. The block size is fixed by `trainingWindow + 1`
 * (the GAT's rolling-window setup); it can't be resized because the
 * model's setup can't be resized.
 */
function WindowScrubber({
  total,
  allMonths,
  trainingWindow,
  predictionMonthIdx,
  onChange,
}: {
  total: number;
  allMonths: string[];
  trainingWindow: number;
  predictionMonthIdx: number;
  onChange: (idx: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startX: number; startIdx: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Clamp to [1, total-1] — need at least one prior month for training.
  const clampPred = useCallback(
    (idx: number) => Math.min(total - 1, Math.max(1, Math.round(idx))),
    [total]
  );

  const predIdx = clampPred(predictionMonthIdx);
  const trainStartIdx = Math.max(0, predIdx - trainingWindow);
  const trainEndIdx = predIdx - 1;

  const pct = (i: number) => (total > 1 ? (i / (total - 1)) * 100 : 0);
  // Half-cell offset so the bands align with month tick marks below.
  const half = total > 1 ? 100 / (total - 1) / 2 : 0;
  const trainStartPct = Math.max(0, pct(trainStartIdx) - half);
  const trainEndPct = pct(trainEndIdx) + half;
  const predEndPct = pct(predIdx) + half;

  const idxFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return predIdx;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      // Anywhere on the track → pred month at that ratio (not window centre;
      // matches the "click to jump prediction month here" mental model).
      return clampPred(Math.round(ratio * (total - 1)));
    },
    [clampPred, predIdx, total]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = { startX: e.clientX, startIdx: predIdx };
    setIsDragging(true);
    // Also jump on initial click if user pressed on empty track (not the block)
    const target = e.target as HTMLElement;
    if (!target.closest("[data-scrub-block]")) {
      onChange(idxFromClientX(e.clientX));
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const deltaMonths = Math.round(
      ((e.clientX - state.startX) / rect.width) * (total - 1)
    );
    const nextIdx = clampPred(state.startIdx + deltaMonths);
    if (nextIdx !== predIdx) onChange(nextIdx);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clampPred(predIdx - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clampPred(predIdx + 1));
    }
  };

  useEffect(() => {
    // Clear any lingering dragging state on unmount.
    return () => {
      dragStateRef.current = null;
    };
  }, []);

  const trainMo = allMonths[trainStartIdx];
  const trainEndMo = allMonths[Math.max(trainStartIdx, trainEndIdx)];
  const predMo = allMonths[predIdx];

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={`Prediction month, currently ${predMo}; trained on ${trainMo} through ${trainEndMo}. Use arrow keys or drag the amber/emerald window.`}
      aria-valuemin={1}
      aria-valuemax={total - 1}
      aria-valuenow={predIdx}
      aria-valuetext={predMo}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "relative h-5 w-full rounded-full border border-border bg-muted/40 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isDragging ? "cursor-grabbing" : "cursor-pointer"
      )}
      style={{ touchAction: "none" }}
    >
      {/* Training block (amber) */}
      <div
        data-scrub-block
        className={cn(
          "absolute top-0 h-full rounded-l-full border-y border-l border-amber-600/60 bg-amber-500/35 dark:border-amber-500/60 dark:bg-amber-400/25",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{
          left: `${trainStartPct}%`,
          width: `${Math.max(0, trainEndPct - trainStartPct)}%`,
        }}
      />
      {/* Prediction block (emerald) — thicker border so it reads as the anchor */}
      <div
        data-scrub-block
        className={cn(
          "absolute top-0 h-full rounded-r-full border-y-2 border-r-2 border-emerald-700 bg-emerald-500/50 dark:border-emerald-400 dark:bg-emerald-400/40",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{
          left: `${trainEndPct}%`,
          width: `${Math.max(1.5, predEndPct - trainEndPct)}%`,
        }}
      />
    </div>
  );
}
