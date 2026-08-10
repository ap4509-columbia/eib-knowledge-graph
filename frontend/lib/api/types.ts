// TypeScript types matching the backend JSON contract.
// Keep in sync with backend/runner.py output.

export type EntityType =
  | "FINANCIAL_ENTITY"
  | "FINANCIALENTITY"
  | "COMPANY"
  | "STOCK_TICKER"
  | "STOCKTICKER"
  | "SECTOR"
  | "MACRO_INDICATOR"
  | "MACROINDICATOR"
  | "ECON_INDICATOR"
  | "ECONINDICATOR"
  | "FIN_INSTRUMENT_INFO"
  | "FININSTRUMENTINFO"
  | "PRODUCT"
  | "DERIVATIVE"
  | "CURRENCY"
  | "BOND"
  | "EVENT"
  | "CONCEPT"
  | "UNK";

export type RelCategory = "SSI" | "GMM" | "GFMK" | "UNK";

export interface Index {
  months: string[];
  latest: string | null;
  hasScores: string[];
  source?: string;
  duration_ms?: number;
}

export interface NodeJson {
  id: string;
  type: EntityType | string;
  degree: number;
  // Optional precomputed layout position (spring_layout, deterministic).
  // When present, the frontend uses Cytoscape's `preset` layout so the graph
  // loads at a fixed "best view" instantly instead of settling from random.
  x?: number;
  y?: number;
}

export type Polarity = "negative" | "neutral" | "positive";

export type CausalType =
  | "CAUSAL"
  | "COMPETITIVE"
  | "CORPORATE_ACTION"
  | "FINANCIAL_METRIC"
  | "STRUCTURAL"
  | "OPERATIONAL"
  | "REGULATORY"
  | "OTHER";

export type EdgeOrigin = "news" | "prediction";

export interface EdgeJson {
  id: string;
  source: string;
  target: string;
  rel: string;
  rel_cat: RelCategory | string;
  polarity: Polarity;
  /** Primary coloring axis. Assigned by keyword classification in the runner. */
  causal_type?: CausalType | string;
  /** "news" for LLM-extracted edges, "prediction" for GAT-scored/generated edges. */
  origin?: EdgeOrigin | string;
  weight: number;
  score: number | null;
}

/** Provenance for a snapshot merged from several months (see lib/mergeSnapshots). */
export interface SnapshotRange {
  from: string;
  to: string;
  /** Every month folded into this snapshot, chronological. */
  months: string[];
  /** Month whose precomputed layout seeded the merged positions, if any. */
  anchor: string | null;
}

export interface Snapshot {
  /** "2020-03" for one month, "2020-03..2021-06" when merged over a range. */
  month: string;
  /** Present only on merged snapshots; absent on runner output. */
  range?: SnapshotRange;
  stats: { nodes: number; edges: number; scored_edges: number };
  nodes: NodeJson[];
  edges: EdgeJson[];
}

// ── Data-source index (multi-corpus support) ──────────────────────────────

export interface DataSource {
  id: string;
  label: string;
  description: string;
  kind: "historical" | "live";
  /** false = "coming soon" placeholder; the dropdown disables the option. */
  available: boolean;
  /** Optional capability tags. "factors" ⇒ the Factor Analysis tab is
   *  enabled for this source (it reads factors/latest.json). */
  features?: string[];
}

export interface SourcesFile {
  default: string;
  sources: DataSource[];
}

// ── GAT predictions (FinDKG-style leaderboard) ────────────────────────────
// Produced by scripts/compute_gat_predictions.py from the CE No-Edge-Feats
// checkpoints. One entry per validation period; the first period has no
// weights (no prior training window) and is absent from `periods`.

export interface PredictedImpactedEntity {
  entity: string;
  type: string;
}

export interface PredictionEntry {
  /** 1-based position in the per-month leaderboard. */
  rank: number;
  entity: string;
  entity_type: string;
  /** Positive = spiking, negative = quieting. Standardized within the period. */
  novelty_z: number;
  /** Edge count in [P-2, P-1, P]; left-zero-padded at the corpus start. */
  trend_3m: [number, number, number];
  predicted_impacted: PredictedImpactedEntity[];
}

export interface PredictionPeriod {
  period: string;
  total_entities: number;
  entries: PredictionEntry[];
}

export interface PredictionsFile {
  model: string;
  strategy: string;
  mrr: number;
  periods: Record<string, PredictionPeriod>;
}

// ── Factor-model bundle (Factor Analysis tab) ──────────────────────────────
// Produced by scraper/factors.py + scraper/run_daily_factors.py — one file
// per day per corpus at sources/<id>/factors/<YYYY-MM-DD>.json, plus a
// factors/latest.json symlink-alike for the UI to fetch without knowing
// today's date first.

export interface FactorEntity {
  name: string;
  type: string;
  cluster: number;
  pc1: number;
  pc2: number;
  pc3: number;
  factors: {
    attention: number;
    sentiment: number;
    consensus: number;
    novelty: number;
    materiality: number;
  };
  n_articles: number;
  event_mix: Array<[string, number]>;
  top_partners: string[];
}

export interface FactorClusterSignature {
  cluster: number;
  size: number;
  signature: Array<{ factor: string; loading: number }>;
  members: string[];
}

export interface FactorsFile {
  corpus: string;
  date: string;
  generated_at: string;
  min_articles: number;
  kept_factors: string[];
  entities: FactorEntity[];
  pca: {
    explained_variance: number[];
    components: number[][];
  };
  kmeans: {
    k: number;
    centroids: number[][];
    clusters: FactorClusterSignature[];
  };
}
