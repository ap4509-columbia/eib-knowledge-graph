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
}

export type Polarity = "negative" | "neutral" | "positive";

export interface EdgeJson {
  id: string;
  source: string;
  target: string;
  rel: string;
  rel_cat: RelCategory | string;
  polarity: Polarity;
  weight: number;
  score: number | null;
}

export interface Snapshot {
  month: string;
  stats: { nodes: number; edges: number; scored_edges: number };
  nodes: NodeJson[];
  edges: EdgeJson[];
}
