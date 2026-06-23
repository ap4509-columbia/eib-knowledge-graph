"use client";

import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ENTITY_COLORS } from "@/components/graphStyles";
import type { Snapshot } from "@/lib/api/types";

export interface FilterRailProps {
  snapshot: Snapshot | null;
  visibleTypes: Set<string>;
  visibleCategories: Set<string>;
  minDegree: number;
  onToggleType: (type: string) => void;
  onToggleCategory: (cat: string) => void;
  onMinDegreeChange: (value: number) => void;
}

export function FilterRail(props: FilterRailProps) {
  const {
    snapshot,
    visibleTypes,
    visibleCategories,
    minDegree,
    onToggleType,
    onToggleCategory,
    onMinDegreeChange,
  } = props;

  // Counts derived from the current snapshot.
  const { typeCounts, catCounts, maxDegree } = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    const catCounts: Record<string, number> = {};
    let maxDegree = 1;
    if (snapshot) {
      for (const n of snapshot.nodes) {
        typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
        if (n.degree > maxDegree) maxDegree = n.degree;
      }
      for (const e of snapshot.edges) {
        catCounts[e.rel_cat] = (catCounts[e.rel_cat] ?? 0) + 1;
      }
    }
    return { typeCounts, catCounts, maxDegree };
  }, [snapshot]);

  const typesSorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const catsSorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 overflow-y-auto">
      <div className="px-4 py-4">
        <h2 className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-3">
          Filters
        </h2>

        {/* Min degree slider */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-zinc-300">Minimum degree</Label>
            <span className="text-xs font-mono text-zinc-400">
              ≥ {minDegree}
            </span>
          </div>
          <Slider
            min={1}
            max={Math.max(maxDegree, 1)}
            step={1}
            value={[minDegree]}
            onValueChange={(v) => {
              const next = Array.isArray(v) ? v[0] : v;
              if (typeof next === "number") onMinDegreeChange(next);
            }}
          />
          <p className="text-[10px] text-zinc-600 mt-1.5 leading-snug">
            Hides nodes mentioned fewer times than the threshold.
          </p>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Entity types */}
        <div className="mt-4 mb-5">
          <Label className="text-xs text-zinc-300 mb-2 block">
            Entity types
          </Label>
          <div className="space-y-1.5">
            {typesSorted.map(([type, count]) => {
              const checked = visibleTypes.has(type);
              const color = ENTITY_COLORS[type] ?? "#71717a";
              return (
                <label
                  key={type}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-zinc-900 rounded px-1.5 py-1 transition group"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleType(type)}
                  />
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 truncate text-zinc-200">{type}</span>
                  <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                    {count}
                  </span>
                </label>
              );
            })}
            {typesSorted.length === 0 && (
              <p className="text-xs text-zinc-600 italic">no data</p>
            )}
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Relation categories */}
        <div className="mt-4">
          <Label className="text-xs text-zinc-300 mb-2 block">
            Relation categories
          </Label>
          <div className="space-y-1.5">
            {catsSorted.map(([cat, count]) => {
              const checked = visibleCategories.has(cat);
              return (
                <label
                  key={cat}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-zinc-900 rounded px-1.5 py-1 transition"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleCategory(cat)}
                  />
                  <span className="flex-1 text-zinc-200">{cat}</span>
                  <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                    {count}
                  </span>
                </label>
              );
            })}
            {catsSorted.length === 0 && (
              <p className="text-xs text-zinc-600 italic">no data</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
