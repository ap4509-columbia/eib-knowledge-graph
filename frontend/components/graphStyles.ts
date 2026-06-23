// Cytoscape stylesheet + entity-type → color palette.
// Stylesheet is built from a small palette so it can adapt to light/dark theme.

import type { StylesheetJson } from "cytoscape";

export const ENTITY_COLORS: Record<string, string> = {
  COMPANY: "#3b82f6", // blue-500
  STOCK_TICKER: "#6366f1", // indigo-500
  STOCKTICKER: "#6366f1",
  FINANCIAL_ENTITY: "#06b6d4", // cyan-500
  FINANCIALENTITY: "#06b6d4",
  SECTOR: "#a855f7", // purple-500
  MACRO_INDICATOR: "#f59e0b", // amber-500
  MACROINDICATOR: "#f59e0b",
  ECON_INDICATOR: "#eab308", // yellow-500
  ECONINDICATOR: "#eab308",
  FIN_INSTRUMENT_INFO: "#10b981", // emerald-500
  FININSTRUMENTINFO: "#10b981",
  PRODUCT: "#ec4899", // pink-500
  DERIVATIVE: "#f43f5e", // rose-500
  CURRENCY: "#22c55e", // green-500
  BOND: "#f97316", // orange-500
  EVENT: "#ef4444", // red-500
  CONCEPT: "#94a3b8", // slate-400
  UNK: "#71717a", // zinc-500
};

interface ThemePalette {
  textColor: string;
  textOutlineColor: string;
  defaultEdgeColor: string;
  nodeBorderColor: string;
  selectedBorderColor: string;
  hoveredEdgeColor: string;
  positiveEdge: string;
  positiveEdgeBright: string;
  negativeEdge: string;
  negativeEdgeBright: string;
  neutralEdgeBright: string;
}

const DARK: ThemePalette = {
  textColor: "#e4e4e7", // zinc-200
  textOutlineColor: "#09090b", // zinc-950
  defaultEdgeColor: "#52525b", // zinc-600
  nodeBorderColor: "#27272a", // zinc-800
  selectedBorderColor: "#fafafa", // zinc-50
  hoveredEdgeColor: "#a1a1aa", // zinc-400
  positiveEdge: "#22c55e", // green-500
  positiveEdgeBright: "#4ade80", // green-400
  negativeEdge: "#ef4444", // red-500
  negativeEdgeBright: "#f87171", // red-400
  neutralEdgeBright: "#d4d4d8", // zinc-300
};

const LIGHT: ThemePalette = {
  textColor: "#18181b", // zinc-900
  textOutlineColor: "#ffffff",
  defaultEdgeColor: "#a1a1aa", // zinc-400
  nodeBorderColor: "#e4e4e7", // zinc-200
  selectedBorderColor: "#09090b", // zinc-950
  hoveredEdgeColor: "#52525b", // zinc-600
  positiveEdge: "#16a34a", // green-600 — slightly darker so it pops on white
  positiveEdgeBright: "#15803d", // green-700
  negativeEdge: "#dc2626", // red-600
  negativeEdgeBright: "#b91c1c", // red-700
  neutralEdgeBright: "#52525b", // zinc-600
};

export function makeGraphStyles(isDark: boolean): StylesheetJson {
  const p = isDark ? DARK : LIGHT;

  return [
    {
      selector: "node",
      style: {
        "background-color": `mapData(degree, 0, 50, ${ENTITY_COLORS.UNK}, ${ENTITY_COLORS.COMPANY})` as unknown as string,
        label: "data(label)",
        color: p.textColor,
        "font-size": 10,
        "text-outline-color": p.textOutlineColor,
        "text-outline-width": 2,
        "text-valign": "center",
        "text-halign": "center",
        width: "mapData(degree, 1, 50, 12, 40)",
        height: "mapData(degree, 1, 50, 12, 40)",
        "border-width": 1,
        "border-color": p.nodeBorderColor,
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
        width: ("mapData(weight, 1, 15, 0.6, 4)" as unknown) as number,
        "line-color": p.defaultEdgeColor,
        "curve-style": "bezier",
        "target-arrow-color": p.defaultEdgeColor,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.6,
        opacity: 0.45,
      },
    },
    // Polarity coloring: bullish (green), bearish (red), neutral (gray)
    {
      selector: 'edge[polarity = "positive"]',
      style: {
        "line-color": p.positiveEdge,
        "target-arrow-color": p.positiveEdge,
        opacity: 0.7,
      },
    },
    {
      selector: 'edge[polarity = "negative"]',
      style: {
        "line-color": p.negativeEdge,
        "target-arrow-color": p.negativeEdge,
        opacity: 0.75,
      },
    },
    {
      selector: "edge.hovered",
      style: {
        "line-color": p.hoveredEdgeColor,
        "target-arrow-color": p.hoveredEdgeColor,
        opacity: 1,
        "z-index": 99,
      },
    },
    // edges with a GAT score render brighter and thicker
    {
      selector: "edge[score]",
      style: {
        width: "mapData(score, 0, 1, 1, 4)" as unknown as number,
        "line-color": p.positiveEdge,
        "target-arrow-color": p.positiveEdge,
        opacity: 0.9,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-color": p.selectedBorderColor,
        "border-width": 3,
      },
    },
    {
      selector: "edge:selected",
      style: {
        "line-color": p.selectedBorderColor,
        "target-arrow-color": p.selectedBorderColor,
        opacity: 1,
      },
    },
    // ── Focus mode: dim everything outside the selected neighborhood ──
    {
      selector: ".dimmed",
      style: {
        opacity: 0.08,
      },
    },
    {
      selector: "node.highlighted",
      style: {
        "border-width": 3,
        "border-color": p.selectedBorderColor,
        "z-index": 99,
      },
    },
    {
      selector: "node.focused",
      style: {
        "border-width": 4,
        "border-color": p.selectedBorderColor,
        "z-index": 100,
      },
    },
    {
      selector: "edge.highlighted",
      style: {
        opacity: 1,
        width: ("mapData(weight, 1, 15, 1.5, 5)" as unknown) as number,
        "z-index": 99,
      },
    },
    // Brighter polarity colors when highlighted
    {
      selector: 'edge.highlighted[polarity = "positive"]',
      style: {
        "line-color": p.positiveEdgeBright,
        "target-arrow-color": p.positiveEdgeBright,
      },
    },
    {
      selector: 'edge.highlighted[polarity = "negative"]',
      style: {
        "line-color": p.negativeEdgeBright,
        "target-arrow-color": p.negativeEdgeBright,
      },
    },
    {
      selector: 'edge.highlighted[polarity = "neutral"]',
      style: {
        "line-color": p.neutralEdgeBright,
        "target-arrow-color": p.neutralEdgeBright,
      },
    },
  ];
}

// Back-compat default export — uses dark theme. Prefer makeGraphStyles().
export const graphStyles = makeGraphStyles(true);
