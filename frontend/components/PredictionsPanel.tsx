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

import { fetchPredictions, fetchPredictionsVariants } from "@/lib/api/client";
import type {
  PredictionEntry,
  PredictionPeriod,
  PredictionsFile,
  PredictionsVariantMeta,
} from "@/lib/api/types";
import { ENTITY_COLORS, entityLabel } from "@/components/graphStyles";

interface PredictionsViewProps {
  /** Which corpus the predictions come from. Fetched per-source. */
  sourceId: string;
  /** The right edge of the currently-selected month range. */
  monthTo: string | null;
}

const ABOUT_COLLAPSED_STORAGE_KEY = "eibkg.predictions.about.collapsed";
const METRICS_COLLAPSED_STORAGE_KEY = "eibkg.predictions.metrics.collapsed";

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
  const label = entityLabel(type);
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
      className={`${COLS} border-b border-border/60 px-6 py-1.5 text-xs last:border-b-0 hover:bg-accent/30 md:py-2.5`}
    >
      <div className="font-mono text-xs tabular-nums text-muted-foreground">
        #{entry.rank}
      </div>
      <div className="truncate font-medium text-foreground">{entry.entity}</div>
      <div>
        <EntityChip
          name={entityLabel(entry.entity_type)}
          type={entry.entity_type}
        />
      </div>
      <ActivityCell z={entry.novelty_z} />
      <Sparkline values={entry.trend_3m} />
      {/* max-h on phone: wrapped chips otherwise inflate rows to ~100px
          and only two companies fit the viewport. */}
      <div className="flex max-h-[3.4rem] flex-wrap gap-1 overflow-hidden md:max-h-none">
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
// In-depth per-encoder explanations for the "How to read this table"
// block. Static (not driven by the variants file) so every encoder in the
// comparison lineup is documented even before its training run registers
// its metrics row — the table gains rows as runs finish, the explainer
// describes the full lineup from day one.
const ENCODER_EXPLAINERS: { id: string; name: string; body: string }[] = [
  {
    id: "gat_edge",
    name: "GAT (Rel+Cat+NormW)",
    body:
      "the baseline: a Graph Attention Network. When an entity aggregates information from its neighbors, it does not treat them equally — it learns attention weights that decide how much each neighbor matters, so a firm's embedding can lean on its most informative connections. This variant also feeds each connection's own attributes into that attention: the relation extracted from the news (Rel — e.g. \"acquires\", \"supplies\"), its causal category (Cat), and its normalized co-occurrence weight (NormW). It won the training-recipe sweep and is the encoder deployed on the historical corpora.",
  },
  {
    id: "gat_noedge",
    name: "GAT (No Edge Feats)",
    body:
      "the identical attention encoder with the edge attributes ablated — it sees only the bare topology of who connects to whom, not what the connections say. The gap between this row and the baseline is a controlled measurement of how much the relation/category/weight features actually contribute to ranking accuracy.",
  },
  {
    id: "sage",
    name: "GraphSAGE",
    body:
      "swaps attention for mean aggregation: each entity's embedding is built by averaging its neighbors' signatures, with no learned weighting and no edge-attribute pathway at all. It is the simplest encoder in the lineup, and it revisits the Spring 2025 team's architecture comparison (their poster also found GraphSAGE competitive with GAT on early versions of this graph).",
  },
  {
    id: "gat_causal",
    name: "GAT + Causal (NOTEARS)",
    body:
      "the baseline GAT encoder, but every entity's input features are extended with 5 causal features before message passing begins. Those features come from a separate step: for each training window, the NOTEARS algorithm (Zheng et al., 2018) learns a directed acyclic graph — a candidate causal structure — from how the top-200 entities co-occur in the news day by day. Each entity then contributes its position in that causal graph: causal out-degree (how many entities it appears to drive), in-degree (how many drive it), outgoing and incoming causal-weight sums, and PageRank on the learned DAG. This ports the Spring 2026 team's causal-feature method into our pipeline and tests whether explicit causal structure adds signal beyond correlational message passing.",
  },
];

function AboutSection({
  mrr,
  hits1,
  hits3,
  hits10,
  months,
  variants,
}: {
  mrr?: number;
  hits1?: number | null;
  hits3?: number | null;
  hits10?: number | null;
  months?: number;
  variants?: PredictionsVariantMeta[] | null;
}) {
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
    <div className="shrink-0 border-b border-border/60 bg-muted/20 short:hidden">
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
              Two parts working together. An{" "}
              <span className="text-foreground">encoder</span> — a graph
              neural network (GNN) such as GAT or GraphSAGE — reads the
              network of entities and their news-derived connections, and
              for each entity produces a numeric signature (an embedding)
              that captures who it tends to appear with. A shared{" "}
              <span className="text-foreground">link-prediction head</span>{" "}
              then scores each candidate pair as the{" "}
              <span className="text-foreground">dot product</span> of the
              two embeddings: aligned signatures score high, and a
              cross-entropy loss trains the encoder to score each true
              partner above negative candidates. The head has no learnable
              parameters of its own — all the learning lives in the
              embeddings — so the encoder alone predicts nothing and the
              head alone has nothing to score; forecasts come from the
              pair.
            </div>
          </div>

          {variants && variants.length > 1 && (
            <div>
              <div className="mb-1 font-medium text-foreground">
                The model encoders (the toggle above the metrics table)
              </div>
              <div className="mb-1.5">
                Every row of the comparison table is the same two-part
                system with one part swapped. The{" "}
                <span className="text-foreground">
                  dot-product link-prediction head
                </span>{" "}
                and the cross-entropy training recipe are identical across
                all rows; only the{" "}
                <span className="text-foreground">GNN encoder</span> that
                produces the entity embeddings changes. Because the head
                has no parameters of its own, any difference in MRR or
                Hits@k between rows is attributable to the encoder — the
                table is a controlled, head-to-head encoder comparison on
                the same corpus, the same backtest months, and the same
                candidate sets.
              </div>
              <ul className="ml-4 list-disc space-y-1">
                {ENCODER_EXPLAINERS.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium text-foreground">
                      {e.name}
                    </span>{" "}
                    — {e.body}
                  </li>
                ))}
                {variants
                  .filter(
                    (v) => !ENCODER_EXPLAINERS.some((e) => e.id === v.id)
                  )
                  .map((v) => (
                    <li key={v.id}>
                      <span className="font-medium text-foreground">
                        {v.label}
                      </span>{" "}
                      — {v.note ?? ""}
                    </li>
                  ))}
              </ul>
              <div className="mt-1.5">
                An encoder described above but missing from the metrics
                table hasn't finished its backtest yet — rows register
                automatically as training runs complete.
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 font-medium text-foreground">
              Reading the scorecard (the stats above the table)
            </div>
            <div>
              The cards at the top are the model&apos;s test results,
              measured by backtesting: for each validation month the model
              trains only on earlier months, then is scored on how well it
              ranks that month&apos;s true links against alternatives.{" "}
              <span className="text-foreground">MRR</span> (mean reciprocal
              rank, 0 to 1, higher is better) averages 1/rank of the true
              answer: at{" "}
              <span className="text-foreground">
                {(mrr ?? 0.77).toFixed(2)}
              </span>{" "}
              the correct co-mover lands around position{" "}
              {(1 / (mrr ?? 0.77)).toFixed(1)} out of ~50 candidates, where
              random guessing would put it around position 26.{" "}
              <span className="text-foreground">Hits@k</span> is the share
              of tests where the true answer appeared in the top k
              {hits1 != null && hits3 != null ? (
                <>
                  {" "}
                  (here: first try {(hits1 * 100).toFixed(0)}% of the time,
                  top-3 {(hits3 * 100).toFixed(0)}%
                  {hits10 != null && (
                    <>, top-10 {(hits10 * 100).toFixed(0)}%</>
                  )}
                  )
                </>
              ) : null}
              . <span className="text-foreground">Backtest months</span> is
              how many held-out months the scores average over
              {months != null && (
                <>
                  {" "}
                  ({months} here)
                </>
              )}
              : more months means a more trustworthy number, which is why
              young live corpora carry a provisional-metrics note.
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
}: PredictionsViewProps) {
  const [data, setData] = useState<PredictionsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Model variants (GAT baseline vs. causal-augmented vs. other GNN
  // configs). Sources without a variants index get the single default.
  const [variants, setVariants] = useState<PredictionsVariantMeta[] | null>(
    null
  );
  const [variantId, setVariantId] = useState<string | null>(null);

  // Backtest metrics (encoder toggle + scorecard) collapse into one slim
  // header row so the leaderboard keeps the screen — on phones the full
  // metrics stack left roughly two table rows visible. Default: collapsed
  // on narrow screens, expanded on desktop; the choice is remembered.
  const [metricsCollapsed, setMetricsCollapsed] = useState(true);
  useEffect(() => {
    const stored = window.localStorage.getItem(METRICS_COLLAPSED_STORAGE_KEY);
    if (stored !== null) {
      setMetricsCollapsed(stored === "1");
    } else {
      // Expand by default only on screens that are both wide AND tall —
      // phone landscape (short) needs the height for the table.
      setMetricsCollapsed(
        !window.matchMedia("(min-width: 768px) and (min-height: 481px)")
          .matches
      );
    }
  }, []);
  const toggleMetrics = () => {
    setMetricsCollapsed((v) => {
      window.localStorage.setItem(METRICS_COLLAPSED_STORAGE_KEY, v ? "0" : "1");
      return !v;
    });
  };

  useEffect(() => {
    if (!sourceId) return;
    setVariants(null);
    setVariantId(null);
    fetchPredictionsVariants(sourceId)
      .then((v) => {
        setVariants(v);
        if (v?.length) setVariantId(v[0].id);
      })
      .catch(() => setVariants(null));
  }, [sourceId]);

  const activeVariant = useMemo(
    () => variants?.find((v) => v.id === variantId) ?? null,
    [variants, variantId]
  );

  useEffect(() => {
    if (!sourceId) return;
    setData(null);
    setError(null);
    fetchPredictions(sourceId, activeVariant?.file ?? "predictions.json")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sourceId, activeVariant]);

  const rawPeriod: PredictionPeriod | null = useMemo(() => {
    if (!data || !monthTo) return null;
    return data.periods[monthTo] ?? null;
  }, [data, monthTo]);

  // The leaderboard always shows every entity type — the graph tab's
  // filters deliberately don't reach this view.
  const period: PredictionPeriod | null = rawPeriod;

  const availablePeriods = useMemo(() => {
    if (!data) return [] as string[];
    return Object.keys(data.periods).sort();
  }, [data]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Metadata strip */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2 font-mono text-[10px] text-muted-foreground short:hidden">
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

      {/* Model encoder switcher — ALWAYS visible when the source ships
          several trained models (it must not hide inside the collapsed
          metrics, or live-source variants look unimplemented on phones).
          The metric comparison table stays behind the collapse below. */}
      {variants && variants.length > 1 && (
        <div className="shrink-0 border-b border-border/60 px-6 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Model encoder
            </span>
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariantId(v.id)}
                title={v.note}
                className={
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition " +
                  (v.id === variantId
                    ? "border-foreground/40 bg-foreground/10 text-foreground"
                    : "border-border bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backtest metrics (comparison table + scorecard) behind one slim
          collapsible header, so the leaderboard keeps the vertical space
          — critical on phones. Collapsed shows a one-line summary. */}
      {data && (
        <button
          type="button"
          onClick={toggleMetrics}
          aria-expanded={!metricsCollapsed}
          className="flex w-full shrink-0 items-center gap-2 border-b border-border/60 px-6 py-2 text-left text-[11px] font-medium text-foreground transition hover:bg-accent/30"
        >
          {metricsCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span>Backtest metrics</span>
          {metricsCollapsed && data.mrr != null && (
            <span className="min-w-0 truncate font-mono text-[10px] tabular-nums text-muted-foreground">
              MRR {data.mrr.toFixed(3)} · {Object.keys(data.periods).length}{" "}
              months
              {activeVariant ? ` · ${activeVariant.label}` : ""}
            </span>
          )}
        </button>
      )}

      {/* Metric comparison table — behind the metrics collapse. */}
      {!metricsCollapsed && variants && variants.length > 1 && (
        <div className="shrink-0 border-b border-border/60 px-6 py-2.5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Variant</th>
                  <th className="py-1 pr-3 font-medium">MRR</th>
                  <th className="py-1 pr-3 font-medium">Hits@1</th>
                  <th className="py-1 pr-3 font-medium">Hits@3</th>
                  <th className="py-1 pr-3 font-medium">Hits@10</th>
                  <th className="py-1 font-medium">Months</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((rawV) => {
                  // The selected variant's predictions file carries fresher
                  // metrics than the registration-time index (live corpora
                  // retrain the baseline daily) — prefer the live numbers.
                  const isActive = rawV.id === variantId;
                  const v =
                    isActive && data?.mrr != null
                      ? {
                          ...rawV,
                          mrr: data.mrr,
                          hits1: data.hits1 ?? rawV.hits1,
                          hits3: data.hits3 ?? rawV.hits3,
                          hits10: data.hits10 ?? rawV.hits10,
                          months: Object.keys(data.periods).length,
                        }
                      : rawV;
                  return (
                  <tr
                    key={v.id}
                    className={
                      isActive ? "text-foreground" : "text-muted-foreground"
                    }
                  >
                    <td className="py-0.5 pr-3">{v.label}</td>
                    <td className="py-0.5 pr-3">{v.mrr.toFixed(3)}</td>
                    <td className="py-0.5 pr-3">
                      {v.hits1 != null ? v.hits1.toFixed(3) : "–"}
                    </td>
                    <td className="py-0.5 pr-3">
                      {v.hits3 != null ? v.hits3.toFixed(3) : "–"}
                    </td>
                    <td className="py-0.5 pr-3">
                      {v.hits10 != null ? v.hits10.toFixed(3) : "–"}
                    </td>
                    <td className="py-0.5">{v.months ?? "–"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            Every variant is a different GNN encoder feeding the same
            dot-product link-prediction head, trained with the same
            cross-entropy recipe — the toggle swaps only how the entity
            embeddings are computed, so the metrics compare encoders
            head-to-head.
          </p>
        </div>
      )}

      {!metricsCollapsed && data && (
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
                  className={
                    "min-w-[6.5rem] rounded-lg border px-4 py-2.5 " +
                    (label === "MRR"
                      ? "border-foreground/30 bg-background shadow-sm"
                      : "border-border bg-background")
                  }
                >
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums leading-tight text-foreground">
                    {(v as number).toFixed(3)}
                  </div>
                </div>
              ))}
            <div className="min-w-[6.5rem] rounded-lg border border-border bg-background px-4 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Backtest months
              </div>
              <div className="text-2xl font-semibold tabular-nums leading-tight text-foreground">
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

      <AboutSection
        mrr={data?.mrr}
        hits1={data?.hits1}
        hits3={data?.hits3}
        hits10={data?.hits10}
        months={data ? Object.keys(data.periods).length : undefined}
        variants={variants}
      />

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
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
