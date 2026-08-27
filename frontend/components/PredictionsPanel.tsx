"use client";

// FinDKG-style ("Top KG Entities") predictions view, rendered as a
// full-height tab alongside the knowledge graph. Data source is the GAT
// model's per-period leaderboard (winning config: CE No Edge Feats,
// MRR 0.7746), baked into a static JSON by
// scripts/compute_gat_predictions.py.
//
// Columns:
//   # | Entity | Type | Activity | News volume (3mo) | Predicted co-movers
//
// The extraction pipeline emits generic phrases ("Quarterly Results") and
// stray numerals as pseudo-entities. Those are filtered at generation time
// so the leaderboard shows real named entities only. Raw dot-product scores
// are hidden — ordinal position carries the strength signal for humans.
//
// The "How to read this" block above the table is the on-ramp for analysts
// who've never seen a link-prediction model before. It stays expanded on
// first load and collapses on click; the choice is remembered in
// localStorage so returning users aren't re-lectured.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";

import { fetchPredictions } from "@/lib/api/client";
import type {
  PredictionEntry,
  PredictionPeriod,
  PredictionsFile,
} from "@/lib/api/types";
import { ENTITY_COLORS, ENTITY_LABELS } from "@/components/graphStyles";

interface PredictionsViewProps {
  /** Which corpus the predictions come from. Fetched per-source. */
  sourceId: string;
  /** The right edge of the currently-selected month range. */
  monthTo: string | null;
  /** Entity types the user has toggled on in the filter rail. Applied to
   *  both the source-entity rows and the impacted chips. Predictions.json
   *  ships every entity type; this narrows the view. */
  visibleTypes: Set<string>;
}

const ABOUT_COLLAPSED_STORAGE_KEY = "eibkg.predictions.about.collapsed";

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
  // Divergent palette: emerald for upside momentum, blue for cooling
  // — mirrors the standard finance convention (green up, blue down)
  // and gives Cooling/Quiet a real visual weight against Spiking/Rising.
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
      : "text-sky-700 dark:text-sky-400";
  } else {
    label = positive ? "Spiking" : "Quiet";
    cls = positive
      ? "text-emerald-800 dark:text-emerald-500 font-medium"
      : "text-sky-700 dark:text-sky-400 font-medium";
  }

  return (
    <span
      className={`text-xs ${cls}`}
      title={`Novelty z-score vs. this entity's own history: ${z.toFixed(2)}`}
    >
      {label}
      <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
        {z >= 0 ? "+" : ""}
        {z.toFixed(2)}
      </span>
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

/** On-ramp for an analyst opening the tab for the first time. Explains what
 *  the model actually predicts (not prices), what a GAT is in plain English,
 *  and how each column is derived. Collapses on click; the choice is
 *  remembered per browser via localStorage so returning users aren't
 *  re-lectured. */
function AboutSection({ mrr }: { mrr?: number }) {
  // Default to COLLAPSED so the table (below) always has room. Users can
  // toggle to expand; choice is remembered per browser via localStorage.
  const [collapsed, setCollapsed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(ABOUT_COLLAPSED_STORAGE_KEY);
    // Only respect an explicit "expanded" preference; missing key stays collapsed
    setCollapsed(stored !== "0");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      ABOUT_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0"
    );
  }, [collapsed, hydrated]);

  return (
    <div className="shrink-0 border-b border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-6 py-2 text-left text-[11px] font-medium text-foreground transition hover:bg-accent/30"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span>How to read this table</span>
      </button>

      {!collapsed && (
        <div className="max-h-64 space-y-3 overflow-y-auto border-t border-border/40 px-6 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <div>
            <div className="mb-1 font-medium text-foreground">
              What is this?
            </div>
            The most influential entities (companies, tickers, sectors,
            institutions) mentioned in this month's financial news, along
            with a per-entity forecast of which other entities are most
            closely linked to them. Each row is one entity; the last column
            is the model's prediction for that entity.
          </div>

          <div>
            <div className="mb-1 font-medium text-foreground">
              What is being predicted (and what is <em>not</em>)?
            </div>
            <div>
              <span className="text-foreground">Not</span> stock prices,
              volatility, or specific market events. The model predicts{" "}
              <span className="text-foreground">graph relationships</span> —
              which entities in the news graph are most closely connected to
              which. Read the last column as: <em>"if this entity is in the
              news, the model expects these other entities to be in the news
              alongside it."</em>
            </div>
          </div>

          <div>
            <div className="mb-1 font-medium text-foreground">
              What is the model?
            </div>
            <div>
              A Graph Attention Network (GAT) — a neural network trained on
              graphs. It reads the network of entities and their news-derived
              connections, and for each entity learns a numeric signature
              that captures who it tends to appear with. Two entities with
              similar signatures are ones the model treats as belonging
              together, even if they haven't been directly linked yet.
            </div>
          </div>

          <div>
            <div className="mb-1 font-medium text-foreground">
              How accurate is it?
            </div>
            <div>
              On rolling monthly link-prediction tests the model's Mean
              Reciprocal Rank is{" "}
              <span className="text-foreground">
                {(mrr ?? 0.77).toFixed(2)}
              </span>
              . In plain English: when asked to rank the true co-mover of an
              entity against 50 random alternatives, the correct one lands
              around position {(1 / (mrr ?? 0.77)).toFixed(1)} on average.
              Random guessing would place it around position 26.
            </div>
          </div>

          <div>
            <div className="mb-1 font-medium text-foreground">
              Activity vs. novelty z-score
            </div>
            <div>
              The Activity column shows both. The number is the{" "}
              <span className="text-foreground">novelty z-score</span>: how
              unusual this entity's recent news volume is versus its own
              history, in standard deviations (edges in the last 3 months
              minus the entity's prior average, standardized across the
              graph). The word is just that score bucketed into
              plain-English bands: within ±1 is{" "}
              <span className="text-foreground">Stable</span>, beyond ±1 is{" "}
              <span className="text-foreground">Rising</span> /{" "}
              <span className="text-foreground">Cooling</span>, and beyond
              ±2 (a rare, two-sigma move) is{" "}
              <span className="text-foreground">Spiking</span> /{" "}
              <span className="text-foreground">Quiet</span>. So
              &ldquo;Spiking +2.55&rdquo; means this entity is generating
              far more news than its own normal — the label and the score
              are one measurement, at two levels of precision.
            </div>
          </div>

          <div>
            <div className="mb-1 font-medium text-foreground">
              How is the ranking built?
            </div>
            <div>
              For each entity we take the average of its predicted-link
              scores against every other entity in the month's graph.
              Entities with high average scores are the ones the model sees
              as central — well-connected to many others. Only named
              entities are eligible for the top-15; generic phrases (
              <span className="font-mono text-foreground/70">
                "Quarterly Results"
              </span>
              ,{" "}
              <span className="font-mono text-foreground/70">
                "Cash Dividend"
              </span>
              ) and stray numerals from the extraction pipeline are filtered
              out, and near-duplicate entities (e.g.{" "}
              <span className="font-mono text-foreground/70">"TXN"</span>{" "}
              and{" "}
              <span className="font-mono text-foreground/70">
                "Texas Instruments Inc"
              </span>
              ) are deduped.
            </div>
          </div>

          <div>
            <div className="mb-1 font-medium text-foreground">Columns.</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>
                <span className="font-medium text-foreground">#</span> —
                position in this month's leaderboard.
              </li>
              <li>
                <span className="font-medium text-foreground">Entity</span> /{" "}
                <span className="font-medium text-foreground">Type</span> —
                the entity and its classification (company, ticker, sector,
                etc.).
              </li>
              <li>
                <span className="font-medium text-foreground">Activity</span>{" "}
                — how the entity's news volume in the last 3 months compares
                to its own historical baseline. <em>Stable</em> = within one
                standard deviation. <em>Rising</em>/<em>Cooling</em> = 1–2
                std moves. <em>Spiking</em>/<em>Quiet</em> = above 2 std.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  News volume (3mo)
                </span>{" "}
                — sparkline of the number of news articles this entity
                appeared in during each of the last 3 months.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Predicted co-movers
                </span>{" "}
                — the top 5 financial entities the model links most strongly
                to this one, ordered strongest first.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function PredictionsView({
  sourceId,
  monthTo,
  visibleTypes,
}: PredictionsViewProps) {
  const [data, setData] = useState<PredictionsFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    setData(null);
    setError(null);
    fetchPredictions(sourceId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sourceId]);

  const rawPeriod: PredictionPeriod | null = useMemo(() => {
    if (!data || !monthTo) return null;
    return data.periods[monthTo] ?? null;
  }, [data, monthTo]);

  // Apply the graph-tab entity-type filter to the leaderboard. The JSON
  // ships every entity type; the filter narrows the view. Impacted chips
  // are also filtered — a co-mover the analyst has hidden shouldn't appear
  // in someone else's row either.
  const period: PredictionPeriod | null = useMemo(() => {
    if (!rawPeriod) return null;
    if (visibleTypes.size === 0) return rawPeriod;
    const entries = rawPeriod.entries
      .filter((e) => visibleTypes.has(e.entity_type))
      .map((e, i) => ({
        ...e,
        // Renumber ranks so the filtered view reads 1, 2, 3 …
        rank: i + 1,
        predicted_impacted: e.predicted_impacted.filter((imp) =>
          visibleTypes.has(imp.type)
        ),
      }));
    return { ...rawPeriod, entries };
  }, [rawPeriod, visibleTypes]);

  const hiddenCount = (rawPeriod?.entries.length ?? 0) - (period?.entries.length ?? 0);

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
              Most-connected entities for{" "}
              <span className="text-foreground">{monthTo}</span>
            </>
          ) : (
            "Select a month below"
          )}
        </span>
        {data && <span>{data.model}</span>}
      </div>

      {/* Backtest scorecard — the model's accuracy stats, front and
          center rather than buried in the header. Renders only when the
          selected source ships predictions (this panel only mounts
          then), so historical-only sources never show it. */}
      {data && (
        <div className="shrink-0 border-b border-border/60 bg-muted/20 px-6 py-3">
          <div
            className="flex flex-wrap items-stretch gap-2"
            title="Backtest: for each validation month the model trains on the preceding window and is scored on how it ranks the month's true links. MRR = mean reciprocal rank of the true target; Hits@k = share of queries where the true target lands in the top k."
          >
            {(
              [
                ["MRR", data.mrr],
                ["Hits@1", data.hits1],
                ["Hits@3", data.hits3],
                ["Hits@10", data.hits10],
              ] as const
            )
              .filter(([, v]) => v != null)
              .map(([label, v]) => (
                <div
                  key={label}
                  className="rounded-md border border-border bg-background px-3 py-1.5"
                >
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </div>
                  <div className="text-base font-semibold tabular-nums text-foreground">
                    {(v as number).toFixed(3)}
                  </div>
                </div>
              ))}
            <div className="rounded-md border border-border bg-background px-3 py-1.5">
              <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Backtest months
              </div>
              <div className="text-base font-semibold tabular-nums text-foreground">
                {Object.keys(data.periods).length}
              </div>
            </div>
          </div>
          {Object.keys(data.periods).length < 12 && (
            <p className="mt-2 text-[11px] leading-snug text-amber-700 dark:text-amber-500">
              Early backtest: this live corpus has only{" "}
              {Object.keys(data.periods).length} validation months so far,
              and the earliest ones train on truncated windows. Treat these
              metrics as provisional — they will stabilize as the corpus
              accumulates history.
            </p>
          )}
        </div>
      )}

      <AboutSection mrr={data?.mrr} />

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
        // overflow-x lets the wide leaderboard grid scroll sideways on
        // phones; the inner min-w keeps header and rows column-aligned.
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div className="flex min-h-0 min-w-[880px] flex-1 flex-col">
          <div
            className={`${COLS} shrink-0 border-b border-border bg-muted/40 px-6 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground`}
          >
            <div title="Position in this month's leaderboard.">#</div>
            <div title="The entity, ranked by the model's assessment of its influence in this month's news graph.">
              Entity
            </div>
            <div title="Company, stock ticker, sector, institution, etc.">
              Type
            </div>
            <div title="News volume in the last 3 months relative to this entity's own history: Spiking, Rising, Stable, Cooling, or Quiet.">
              Activity
            </div>
            <div title="Article count for the last 3 months.">
              News volume (3mo)
            </div>
            <div title="Top 5 financial entities the model links most strongly to this one, ordered strongest first. This is the model's prediction.">
              Predicted co-movers
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {period.entries.map((entry) => (
              <EntryRow key={entry.entity} entry={entry} />
            ))}
            <div className="border-t border-border/50 px-6 py-3 text-[10px] leading-relaxed text-muted-foreground">
              Showing {period.entries.length} entities of{" "}
              {period.total_entities} active in{" "}
              <span className="font-mono">{period.period}</span>.
              {hiddenCount > 0 && (
                <>
                  {" "}
                  {hiddenCount} more hidden by the entity-type filter (toggle
                  types in the left rail to show).
                </>
              )}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
