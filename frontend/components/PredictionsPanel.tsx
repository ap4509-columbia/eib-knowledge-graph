"use client";

// FinDKG-style ("Top KG Entities") predictions view, rendered as a
// full-height tab alongside the knowledge graph. Data source is the GAT
// model's per-period leaderboard (winning config: CE No Edge Feats,
// MRR 0.7746), baked into a static JSON by
// scripts/compute_gat_predictions.py.
//
// Columns (rewritten to be readable to non-engineers):
//   # | Entity | Type | Activity | 3-mo trend | Predicted most impacted
//
// The extraction pipeline emits a lot of generic phrases ("Quarterly
// Results", "Cash Dividend") and stray numerals as pseudo-entities. Those
// are filtered out at generation time so the leaderboard shows real named
// entities only. Score numbers on the impacted list are hidden — ordinal
// position carries the strength signal; the raw dot products are not
// meaningful to an analyst.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { fetchPredictions } from "@/lib/api/client";
import type {
  PredictionEntry,
  PredictionPeriod,
  PredictionsFile,
} from "@/lib/api/types";
import { ENTITY_COLORS, ENTITY_LABELS } from "@/components/graphStyles";

interface PredictionsViewProps {
  /** The right edge of the currently-selected month range. */
  monthTo: string | null;
}

function Sparkline({ values }: { values: readonly number[] }) {
  // Fixed viewport so rows stay comparable regardless of absolute magnitude.
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 48;
      const y = 14 - (v / max) * 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={48}
      height={14}
      className="text-foreground/55"
      aria-label={`Recent 3-month activity: ${values.join(", ")}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.map((v, i) => {
        const x = (i / Math.max(1, values.length - 1)) * 48;
        const y = 14 - (v / max) * 12;
        return <circle key={i} cx={x} cy={y} r={1.2} fill="currentColor" />;
      })}
    </svg>
  );
}

function ActivityCell({ z }: { z: number }) {
  // Plain-English label instead of a bare z-score number. Thresholds
  // chosen at |z| = 1 (one standard-deviation move) and |z| = 2 (rare).
  const abs = Math.abs(z);
  const positive = z > 0;

  let label: string;
  let cls: string;

  if (abs < 1) {
    label = "Stable";
    cls = "text-muted-foreground";
  } else if (abs < 2) {
    label = positive ? "Rising" : "Cooling";
    cls = positive
      ? "text-emerald-800 dark:text-emerald-500"
      : "text-muted-foreground";
  } else {
    label = positive ? "Spiking" : "Quiet";
    cls = positive
      ? "text-emerald-800 dark:text-emerald-500 font-medium"
      : "text-muted-foreground";
  }

  return (
    <span
      className={`text-xs ${cls}`}
      title={`Activity z-score vs. this entity's own history: ${z.toFixed(2)}`}
    >
      {label}
    </span>
  );
}

function EntityChip({ name, type }: { name: string; type: string }) {
  const color = ENTITY_COLORS[type] ?? "#9ca3af";
  const label = ENTITY_LABELS[type] ?? type;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-background px-1.5 py-0.5 text-[10px] text-foreground/80"
      title={label}
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
        style={{ backgroundColor: color }}
      />
      <span className="max-w-[9rem] truncate">{name}</span>
    </span>
  );
}

const COLS =
  "grid grid-cols-[2.5rem_minmax(11rem,1fr)_8rem_5.5rem_4rem_minmax(0,2.5fr)] items-center gap-4";

function EntryRow({ entry }: { entry: PredictionEntry }) {
  return (
    <div
      className={`${COLS} border-b border-border/60 px-6 py-2.5 text-xs last:border-b-0 hover:bg-accent/30`}
    >
      <div className="font-mono text-xs tabular-nums text-muted-foreground">
        #{entry.rank}
      </div>
      <div className="truncate font-medium text-foreground">{entry.entity}</div>
      <div>
        <EntityChip
          name={ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
          type={entry.entity_type}
        />
      </div>
      <ActivityCell z={entry.novelty_z} />
      <Sparkline values={entry.trend_3m} />
      <div className="flex flex-wrap gap-1 overflow-hidden">
        {entry.predicted_impacted.length === 0 ? (
          <span className="text-[10px] italic text-muted-foreground">
            (no strong targets)
          </span>
        ) : (
          entry.predicted_impacted.map((imp) => (
            <EntityChip key={imp.entity} name={imp.entity} type={imp.type} />
          ))
        )}
      </div>
    </div>
  );
}

export function PredictionsView({ monthTo }: PredictionsViewProps) {
  const [data, setData] = useState<PredictionsFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPredictions()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const period: PredictionPeriod | null = useMemo(() => {
    if (!data || !monthTo) return null;
    return data.periods[monthTo] ?? null;
  }, [data, monthTo]);

  const availablePeriods = useMemo(() => {
    if (!data) return [] as string[];
    return Object.keys(data.periods).sort();
  }, [data]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Metadata strip */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2 font-mono text-[10px] text-muted-foreground">
        <span>
          {monthTo ? (
            <>
              Top KG entities for <span className="text-foreground">{monthTo}</span>
            </>
          ) : (
            "Select a month below"
          )}
        </span>
        {data && (
          <span>
            {data.model} · rolling-window MRR {data.mrr.toFixed(3)}
          </span>
        )}
      </div>

      {/* One-line legend so a first-time viewer knows what they're looking at */}
      <div className="shrink-0 border-b border-border/60 bg-muted/20 px-6 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Entities ranked by how strongly the GAT model predicts links from them
        to the rest of the graph in this month. <span className="text-foreground">Activity</span> compares the
        entity's news volume in the last 3 months to its own history. <span className="text-foreground">3-mo trend</span> shows
        month-by-month article counts. <span className="text-foreground">Predicted most impacted</span> lists the top
        financial entities the model expects to move with this one.
      </div>

      {error && (
        <div className="px-6 py-6 text-xs text-destructive">
          Failed to load predictions: {error}
        </div>
      )}

      {!error && !data && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Loading predictions…
        </div>
      )}

      {!error && data && !period && (
        <div className="px-6 py-6 text-xs text-muted-foreground">
          No GAT weights for <span className="font-mono">{monthTo}</span>.
          {monthTo && monthTo < (availablePeriods[0] ?? "") ? (
            <> This is the first period in the corpus — the rolling-window
              trainer had no prior data to fit on, so no checkpoint was saved.
              Available:{" "}
              <span className="font-mono">
                {availablePeriods[0]} → {availablePeriods.slice(-1)[0]}
              </span>.
            </>
          ) : (
            <> Available:{" "}
              <span className="font-mono">
                {availablePeriods[0]} → {availablePeriods.slice(-1)[0]}
              </span>.
            </>
          )}
        </div>
      )}

      {period && (
        <>
          <div
            className={`${COLS} shrink-0 border-b border-border bg-muted/40 px-6 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground`}
          >
            <div>#</div>
            <div>Entity</div>
            <div>Type</div>
            <div>Activity</div>
            <div>3-mo trend</div>
            <div>Predicted most impacted</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {period.entries.map((entry) => (
              <EntryRow key={entry.entity} entry={entry} />
            ))}
            <div className="border-t border-border/50 px-6 py-3 text-[10px] leading-relaxed text-muted-foreground">
              Showing top {period.entries.length} named entities of{" "}
              {period.total_entities} active in{" "}
              <span className="font-mono">{period.period}</span>. Generic
              phrases ("Quarterly Results", "Cash Dividend") and stray
              numerals are filtered out; near-duplicate entities are deduped.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
