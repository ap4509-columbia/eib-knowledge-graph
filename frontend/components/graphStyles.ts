// Cytoscape stylesheet + entity-type → color palette.
// Colors picked to be distinguishable on a dark background.

import type { StylesheetJson } from "cytoscape";

export const ENTITY_COLORS: Record<string, string> = {
  COMPANY: "#3b82f6",            // blue-500
  STOCK_TICKER: "#6366f1",       // indigo-500
  STOCKTICKER: "#6366f1",
  FINANCIAL_ENTITY: "#06b6d4",   // cyan-500
  FINANCIALENTITY: "#06b6d4",
  SECTOR: "#a855f7",             // purple-500
  MACRO_INDICATOR: "#f59e0b",    // amber-500
  MACROINDICATOR: "#f59e0b",
  ECON_INDICATOR: "#eab308",     // yellow-500
  ECONINDICATOR: "#eab308",
  FIN_INSTRUMENT_INFO: "#10b981",// emerald-500
  FININSTRUMENTINFO: "#10b981",
  PRODUCT: "#ec4899",            // pink-500
  DERIVATIVE: "#f43f5e",         // rose-500
  CURRENCY: "#22c55e",           // green-500
  BOND: "#f97316",               // orange-500
  EVENT: "#ef4444",              // red-500
  CONCEPT: "#94a3b8",            // slate-400
  UNK: "#71717a",                // zinc-500
};

const colorMapping = Object.entries(ENTITY_COLORS)
  .map(([type, color]) => `data(type) = '${type}' ? '${color}'`)
  .join(" : ") + " : '#71717a'";

export const graphStyles: StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": `mapData(degree, 0, 50, ${ENTITY_COLORS.UNK}, ${ENTITY_COLORS.COMPANY})` as unknown as string,
      "label": "data(label)",
      "color": "#e4e4e7",
      "font-size": 10,
      "text-outline-color": "#09090b",
      "text-outline-width": 2,
      "text-valign": "center",
      "text-halign": "center",
      "width": "mapData(degree, 1, 50, 12, 40)",
      "height": "mapData(degree, 1, 50, 12, 40)",
      "border-width": 1,
      "border-color": "#27272a",
    },
  },
  // type-specific colors — one selector per type
  ...Object.entries(ENTITY_COLORS).map(([type, color]) => ({
    selector: `node[type = "${type}"]`,
    style: { "background-color": color },
  })),
  {
    selector: "edge",
    style: {
      "width": ("mapData(weight, 1, 15, 0.6, 4)" as unknown) as number,
      "line-color": "#52525b",
      "curve-style": "bezier",
      "target-arrow-color": "#52525b",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.6,
      "opacity": 0.45,
    },
  },
  // Polarity coloring: bullish (green), bearish (red), neutral (gray)
  {
    selector: 'edge[polarity = "positive"]',
    style: {
      "line-color": "#22c55e",
      "target-arrow-color": "#22c55e",
      "opacity": 0.7,
    },
  },
  {
    selector: 'edge[polarity = "negative"]',
    style: {
      "line-color": "#ef4444",
      "target-arrow-color": "#ef4444",
      "opacity": 0.75,
    },
  },
  {
    selector: "edge.hovered",
    style: {
      "line-color": "#a1a1aa",
      "target-arrow-color": "#a1a1aa",
      "opacity": 1,
      "z-index": 99,
    },
  },
  // edges with a GAT score render brighter and thicker
  {
    selector: "edge[score]",
    style: {
      "width": "mapData(score, 0, 1, 1, 4)" as unknown as number,
      "line-color": "#22c55e",
      "target-arrow-color": "#22c55e",
      "opacity": 0.9,
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#fafafa",
      "border-width": 3,
    },
  },
  {
    selector: "edge:selected",
    style: {
      "line-color": "#fafafa",
      "target-arrow-color": "#fafafa",
      "opacity": 1,
    },
  },
  // ── Focus mode: dim everything outside the selected neighborhood ──
  {
    selector: ".dimmed",
    style: {
      "opacity": 0.08,
    },
  },
  {
    selector: "node.highlighted",
    style: {
      "border-width": 3,
      "border-color": "#fafafa",
      "z-index": 99,
    },
  },
  {
    selector: "node.focused",
    style: {
      "border-width": 4,
      "border-color": "#fafafa",
      "z-index": 100,
    },
  },
  {
    selector: "edge.highlighted",
    style: {
      "opacity": 1,
      "width": ("mapData(weight, 1, 15, 1.5, 5)" as unknown) as number,
      "z-index": 99,
    },
  },
  // Brighter polarity colors when highlighted (so green/red stay green/red)
  {
    selector: 'edge.highlighted[polarity = "positive"]',
    style: {
      "line-color": "#4ade80", // green-400
      "target-arrow-color": "#4ade80",
    },
  },
  {
    selector: 'edge.highlighted[polarity = "negative"]',
    style: {
      "line-color": "#f87171", // red-400
      "target-arrow-color": "#f87171",
    },
  },
  {
    selector: 'edge.highlighted[polarity = "neutral"]',
    style: {
      "line-color": "#d4d4d8", // zinc-300
      "target-arrow-color": "#d4d4d8",
    },
  },
];
