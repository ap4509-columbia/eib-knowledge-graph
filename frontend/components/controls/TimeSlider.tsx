"use client";

import { Slider } from "@/components/ui/slider";

export interface TimeSliderProps {
  months: string[];
  currentMonth: string | null;
  onChange: (month: string) => void;
}

export function TimeSlider({ months, currentMonth, onChange }: TimeSliderProps) {
  if (months.length === 0) {
    return (
      <div className="px-6 py-4 border-t border-zinc-800 text-xs text-zinc-500 font-mono">
        no months available
      </div>
    );
  }

  const currentIdx = currentMonth ? Math.max(0, months.indexOf(currentMonth)) : 0;
  const first = months[0];
  const last = months[months.length - 1];

  return (
    <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
          {first}
        </span>
        <span className="text-sm font-mono font-medium text-zinc-100 tabular-nums">
          {months[currentIdx] ?? "—"}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
          {last}
        </span>
      </div>
      <Slider
        min={0}
        max={months.length - 1}
        step={1}
        value={[currentIdx]}
        onValueChange={(v) => {
          const idx = Array.isArray(v) ? v[0] : v;
          if (typeof idx !== "number") return;
          const next = months[idx];
          if (next && next !== currentMonth) onChange(next);
        }}
      />
    </div>
  );
}
