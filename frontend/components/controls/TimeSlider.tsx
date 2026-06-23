"use client";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface TimeSliderProps {
  /** Months with actual data, in ascending order (e.g. ["2019-01", ...]). */
  months: string[];
  /** Months that extend past the dataset for predictions. */
  futureMonths: string[];
  /** Currently selected month (must be in months or futureMonths). */
  currentMonth: string | null;
  onChange: (month: string) => void;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

export function TimeSlider({
  months,
  futureMonths,
  currentMonth,
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

  const currentIdx = currentMonth
    ? Math.max(0, allMonths.indexOf(currentMonth))
    : 0;
  const inFuture = currentIdx >= months.length;
  const futureStartPct = total > 1 ? (months.length / (total - 1)) * 100 : 100;
  const thumbPct = total > 1 ? (currentIdx / (total - 1)) * 100 : 0;

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
      {/* Floating current-month label — follows the thumb */}
      <div className="relative mb-2 h-6">
        <div
          className="absolute top-0 -translate-x-1/2 transition-[left] duration-100"
          style={{ left: `${thumbPct}%` }}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums shadow-sm",
              inFuture
                ? "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                : "border-border bg-background text-foreground"
            )}
          >
            {currentMonth ? formatMonth(currentMonth) : "—"}
            {inFuture && (
              <span className="rounded-sm bg-purple-500/20 px-1 text-[8px] uppercase tracking-wider">
                forecast
              </span>
            )}
          </span>
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
            value={[currentIdx]}
            onValueChange={(v) => {
              const idx = Array.isArray(v) ? v[0] : v;
              if (typeof idx !== "number") return;
              const next = allMonths[idx];
              if (next && next !== currentMonth) onChange(next);
            }}
          />
        </div>

        {/* Per-month tick marks below the track */}
        <div className="pointer-events-none relative mt-1 h-2.5">
          {allMonths.map((m, i) => {
            const isJan = m.endsWith("-01");
            const isFutureTick = i >= months.length;
            return (
              <div
                key={m}
                className={cn(
                  "absolute top-0 w-px -translate-x-1/2",
                  isJan ? "h-2.5" : "h-1.5",
                  isFutureTick
                    ? "bg-purple-500/50"
                    : isJan
                      ? "bg-muted-foreground/70"
                      : "bg-border"
                )}
                style={{ left: total > 1 ? `${(i / (total - 1)) * 100}%` : "0%" }}
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
              style={{
                left: total > 1 ? `${(idx / (total - 1)) * 100}%` : "0%",
              }}
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
