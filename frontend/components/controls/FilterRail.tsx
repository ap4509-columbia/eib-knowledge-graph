"use client";

import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  CAUSAL_TYPE_COLORS,
  CAUSAL_TYPE_LABELS,
  ENTITY_COLORS,
} from "@/components/graphStyles";
import type { Snapshot } from "@/lib/api/types";

export interface FilterRailProps {
  snapshot: Snapshot | null;
  visibleTypes: Set<string>;
  visibleCategories: Set<string>;
  /** Slider value as a percentage of maxDegree (0–100). */
  minDegreePct: number;
  /** Absolute degree threshold computed from minDegreePct × maxDegree. */
  minDegree: number;
  /** Max degree in the current snapshot. */
  maxDegree: number;
  onToggleType: (type: string) => void;
  onToggleCategory: (cat: string) => void;
  onMinDegreePctChange: (value: number) => void;
}

export function FilterRail(props: FilterRailProps) {
  const {
    snapshot,
    visibleTypes,
    visibleCategories,
    minDegreePct,
    minDegree,
    maxDegree,
    onToggleType,
    onToggleCategory,
    onMinDegreePctChange,
  } = props;

  // Type + causal-type counts for the current snapshot.
  // (Category list swapped from rel_cat SSI/GMM/GFMK to the causal-type
  // families that drive edge coloring — same variable name kept for now.)
  const { typeCounts, catCounts } = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    const catCounts: Record<string, number> = {};
    if (snapshot) {
      for (const n of snapshot.nodes) {
        typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
      }
      for (const e of snapshot.edges) {
        const key = e.causal_type ?? "OTHER";
        catCounts[key] = (catCounts[key] ?? 0) + 1;
      }
    }
    return { typeCounts, catCounts };
  }, [snapshot]);

  const typesSorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const catsSorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-background">
      <div className="px-4 py-4">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Filters
        </h2>

        {/* Min degree slider — proportional to the month's max */}
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs">Minimum connections</Label>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {minDegreePct}%  ·  ≥ {minDegree}
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[minDegreePct]}
            onValueChange={(v) => {
              const next = Array.isArray(v) ? v[0] : v;
              if (typeof next === "number") onMinDegreePctChange(next);
            }}
          />
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            Hides nodes with fewer than {minDegree} connection
            {minDegree === 1 ? "" : "s"} (max in view: {maxDegree}).
          </p>
        </div>

        <Separator />

        {/* Entity types */}
        <div className="mb-5 mt-4">
          <Label className="mb-2 block text-xs">Entity types</Label>
          <div className="space-y-1.5">
            {typesSorted.map(([type, count]) => {
              const checked = visibleTypes.has(type);
              const color = ENTITY_COLORS[type] ?? "#71717a";
              return (
                <label
                  key={type}
                  className="group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleType(type)}
                  />
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 truncate">{type}</span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </label>
              );
            })}
            {typesSorted.length === 0 && (
              <p className="text-xs italic text-muted-foreground">no data</p>
            )}
          </div>
        </div>

        <Separator />

        {/* Causal types — primary edge coloring signal, doubles as legend */}
        <div className="mt-4">
          <Label className="mb-2 block text-xs">Edge meaning (causal type)</Label>
          <div className="space-y-1.5">
            {catsSorted.map(([cat, count]) => {
              const checked = visibleCategories.has(cat);
              const color = CAUSAL_TYPE_COLORS[cat] ?? "#94a3b8";
              const label = CAUSAL_TYPE_LABELS[cat] ?? cat;
              return (
                <label
                  key={cat}
                  className="group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleCategory(cat)}
                  />
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 truncate">{label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </label>
              );
            })}
            {catsSorted.length === 0 && (
              <p className="text-xs italic text-muted-foreground">no data</p>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            Dashed edges = model predictions; solid edges = extracted from news.
          </p>
        </div>
      </div>
    </aside>
  );
}
