"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Dataset-boundary annotation: rendered at endNote.month's cell once
   *  that month exists on the axis (e.g. "FNSPID dataset ends here"). */
  endNote?: { text: string; month: string };
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
  endNote,
}: TimeSliderProps) {
  const allMonths = [...months, ...futureMonths];
  const total = allMonths.length;

  // Measured width of the label row — long corpora (15 years = 16 year
  // labels) need adaptive thinning or the year numbers overlap.
  // Hooks live above the early return to satisfy the rules of hooks.
  const labelRowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const el = labelRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRowWidth(el.clientWidth));
    ro.observe(el);
    setRowWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

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

  // Cell model: each month owns an equal slot of the track, so a 1-month
  // selection is a full cell wide (not a zero-width point) and cell
  // boundaries are the snap grid for every scrubber. cellStart(i) is the
  // left edge of month i's cell; cellStart(total) is the track's right end.
  const cellW = 100 / total;
  const cellStart = (i: number) => i * cellW;
  const futureStartPct = cellStart(months.length);

  // Predictions-tab legend gate — rendered when the prediction month has at
  // least one prior month to train on. (The WindowScrubber below draws the
  // actual bands; positions live there.)
  const predictionBand =
    predictionsContext &&
    allMonths.indexOf(predictionsContext.predictionMonth) > 0;

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
  // Thin the year labels to what actually fits: ~40px per "2026"-style
  // label, measured against the row's real width. Long corpora keep every
  // Nth year instead of overlapping all of them.
  const yearStride = Math.max(
    1,
    Math.ceil((yearTicks.length * 40) / Math.max(rowWidth, 240))
  );
  const yearTicksShown = yearTicks.filter((_, i) => i % yearStride === 0);
  // Very dense axes (>96 months) drop the minor month ticks — January
  // ticks alone carry the rhythm; minors become sub-5px noise.
  const showMinorTicks = total <= 96;

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
            make sense when only one month drives the view. */}
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
              title={`Window size fixed at ${predictionsContext!.trainingWindow} training months (1 quarter) per the rolling-window GAT — see scripts/compute_gat_predictions.py. Raw per-month prediction bundle: this source's predictions.json under /data/sources/ — hover to verify against the model.`}
            >
              drag the window · rolling window = {predictionsContext!.trainingWindow} months
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
            <RangeScrubber
              total={total}
              allMonths={allMonths}
              fromIdx={fromIdx}
              toIdx={toIdx}
              onChange={(f, t) => emit(f, t)}
            />
          )}
        </div>

        {/* Month-boundary ticks below the track. Each tick marks the START
            of a month's cell (plus one closing tick at the far right), so
            they line up with the scrubber block's edges. */}
        <div className="pointer-events-none relative mt-1 h-2.5">
          {allMonths.map((m, i) => {
            const isJan = m.endsWith("-01");
            if (!isJan && !showMinorTicks) return null;
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
                style={{ left: `${cellStart(i)}%` }}
              />
            );
          })}
          <div
            className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-border"
            style={{ left: "100%" }}
          />
        </div>

        {/* Dataset-boundary note — appears once its month is on the axis */}
        {endNote && allMonths.includes(endNote.month) && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-full whitespace-nowrap rounded-sm bg-muted/90 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
            style={{ left: `${cellStart(allMonths.indexOf(endNote.month) + 1)}%` }}
          >
            {endNote.text} ⇥
          </div>
        )}

        {/* Year labels along the bottom — adaptively thinned to fit */}
        <div ref={labelRowRef} className="relative mt-1 h-4">
          {yearTicksShown.map(({ year, idx }) => (
            <span
              key={year}
              className="absolute -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
              style={{ left: `${cellStart(idx)}%` }}
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

  // Cell model (matches the KG scrubber and the tick row): month i owns
  // [i, i+1)/total of the track. Amber covers the training months' cells;
  // emerald covers the prediction month's full cell.
  const cellW = 100 / total;
  const trainStartPct = trainStartIdx * cellW;
  const trainEndPct = (trainEndIdx + 1) * cellW;
  const predEndPct = (predIdx + 1) * cellW;

  const idxFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return predIdx;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      // Anywhere on the track → pred month whose cell was clicked (not
      // window centre; matches "click to jump prediction month here").
      return clampPred(Math.floor(ratio * total));
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
      ((e.clientX - state.startX) / rect.width) * total
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
        "relative h-5 w-full overflow-hidden rounded-full border border-border bg-muted/40 outline-none",
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


/**
 * The knowledge-graph timeline scrubber — same interaction model as the
 * Predictions WindowScrubber but neutral-colored and resizable. The
 * selected range renders as a visible block whose edges land exactly on
 * month ticks. Drag the middle to slide the whole window (span
 * preserved); drag either edge handle to resize; click the empty track
 * to jump the window there; arrow keys nudge by one month.
 */
function RangeScrubber({
  total,
  allMonths,
  fromIdx,
  toIdx,
  onChange,
}: {
  total: number;
  allMonths: string[];
  fromIdx: number;
  toIdx: number;
  onChange: (from: number, to: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: "move" | "left" | "right";
    startX: number;
    startFrom: number;
    startTo: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // While move-dragging, the block follows the pointer continuously (this
  // holds its live left edge in %); the emitted month range still snaps.
  // Null when idle → block sits exactly on its cells.
  const [liveLeftPct, setLiveLeftPct] = useState<number | null>(null);

  // Cell model — month i owns [i, i+1) / total of the track, so a 1-month
  // window renders one full cell wide instead of collapsing to a point.
  const cellW = 100 / total;
  const span = toIdx - fromIdx; // in cells minus one; block covers span+1 cells
  const clampFrom = (i: number) =>
    Math.min(total - 1 - span, Math.max(0, i));

  const monthFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return fromIdx;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(total - 1, Math.max(0, Math.floor(ratio * total)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const target = e.target as HTMLElement;
    const mode: "move" | "left" | "right" = target.closest(
      "[data-handle='left']"
    )
      ? "left"
      : target.closest("[data-handle='right']")
        ? "right"
        : "move";
    let from = fromIdx;
    let to = toIdx;
    // Click on empty track: centre the window on the clicked month first,
    // then the same gesture keeps dragging it.
    if (mode === "move" && !target.closest("[data-scrub-block]")) {
      from = clampFrom(monthFromClientX(e.clientX) - Math.round(span / 2));
      to = from + span;
      onChange(from, to);
    }
    dragRef.current = { mode, startX: e.clientX, startFrom: from, startTo: to };
    setIsDragging(true);
    if (mode === "move") setLiveLeftPct(from * cellW);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    const el = trackRef.current;
    if (!st || !el) return;
    const rect = el.getBoundingClientRect();
    const deltaPct = ((e.clientX - st.startX) / rect.width) * 100;

    if (st.mode === "left") {
      const nextFrom = Math.min(
        st.startTo,
        Math.max(0, Math.round(st.startFrom + deltaPct / cellW))
      );
      if (nextFrom !== fromIdx) onChange(nextFrom, toIdx);
      return;
    }
    if (st.mode === "right") {
      const nextTo = Math.max(
        st.startFrom,
        Math.min(total - 1, Math.round(st.startTo + deltaPct / cellW))
      );
      if (nextTo !== toIdx) onChange(fromIdx, nextTo);
      return;
    }
    // Move: block glides with the pointer; the selection snaps to whichever
    // cells the block mostly covers.
    const startSpan = st.startTo - st.startFrom;
    const maxLeft = (total - startSpan - 1) * cellW;
    const rawLeft = Math.min(
      maxLeft,
      Math.max(0, st.startFrom * cellW + deltaPct)
    );
    setLiveLeftPct(rawLeft);
    const nextFrom = clampFrom(Math.round(rawLeft / cellW));
    if (nextFrom !== fromIdx) onChange(nextFrom, nextFrom + startSpan);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setIsDragging(false);
    setLiveLeftPct(null); // snap the block back onto its cells
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const nextFrom = fromIdx + step;
    const nextTo = toIdx + step;
    if (nextFrom < 0 || nextTo > total - 1) return;
    onChange(nextFrom, nextTo);
  };

  const leftPct = liveLeftPct ?? fromIdx * cellW;
  const widthPct = (span + 1) * cellW;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={`Selected month range, ${allMonths[fromIdx]} through ${allMonths[toIdx]}. Drag the block to slide, drag its edges to resize, arrow keys to nudge.`}
      aria-valuemin={0}
      aria-valuemax={total - 1}
      aria-valuenow={fromIdx}
      aria-valuetext={`${allMonths[fromIdx]} – ${allMonths[toIdx]}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "relative h-5 w-full overflow-hidden rounded-full border border-border bg-muted/40 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isDragging ? "cursor-grabbing" : "cursor-pointer"
      )}
      style={{ touchAction: "none" }}
    >
      {/* Selected-range block — neutral counterpart of the predictions
          window. Edges land exactly on month ticks. */}
      <div
        data-scrub-block
        className={cn(
          "absolute top-0 h-full rounded-full border border-foreground/40 bg-foreground/15",
          isDragging
            ? "cursor-grabbing"
            : "cursor-grab transition-[left,width] duration-150 ease-out"
        )}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      >
        {/* Resize handles — invisible edge zones (the ew-resize cursor is
            the affordance; visible grip bars read as misaligned ticks) */}
        <div
          data-handle="left"
          className="absolute left-0 top-0 h-full w-3.5 cursor-ew-resize"
        />
        <div
          data-handle="right"
          className="absolute right-0 top-0 h-full w-3.5 cursor-ew-resize"
        />
      </div>
    </div>
  );
}
