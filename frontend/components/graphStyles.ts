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
      "width": 1,
      "line-color": "#3f3f46",
      "curve-style": "bezier",
      "target-arrow-color": "#3f3f46",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.6,
      "opacity": 0.6,
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
];
