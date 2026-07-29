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

export interface Snapshot {
  month: string;
  stats: { nodes: number; edges: number; scored_edges: number };
  nodes: NodeJson[];
  edges: EdgeJson[];
}
