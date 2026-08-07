// Cytoscape stylesheet + entity/causal-type color palettes.
// Stylesheet is built from a small palette so it adapts to light/dark theme.

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
  // Real categories the extractor produces that the schema doesn't model yet
  // (see _UNMODELED_ENTITY_TYPES in backend/runner.py). Colored so they don't
  // all read as UNK gray while the team decides whether to promote them.
  PERSON: "#8b5cf6", // violet-500
  COUNTRY: "#14b8a6", // teal-500
  LOCATION: "#0ea5e9", // sky-500
  INSTITUTION: "#64748b", // slate-500
};

// Human-readable labels for the entity-type filter. The raw values are
// run-together uppercase ("FININSTRUMENTINFO"), which is unreadable in a
// sidebar. Mirrors CAUSAL_TYPE_LABELS below. Anything missing falls back to
// the raw value, so a new type degrades to shouty rather than blank.
export const ENTITY_LABELS: Record<string, string> = {
  COMPANY: "Company",
  STOCK_TICKER: "Stock ticker",
  STOCKTICKER: "Stock ticker",
  FINANCIAL_ENTITY: "Financial entity",
  FINANCIALENTITY: "Financial entity",
  SECTOR: "Sector",
  MACRO_INDICATOR: "Macro indicator",
  MACROINDICATOR: "Macro indicator",
  ECON_INDICATOR: "Economic indicator",
  ECONINDICATOR: "Economic indicator",
  FIN_INSTRUMENT_INFO: "Financial instrument",
  FININSTRUMENTINFO: "Financial instrument",
  PRODUCT: "Product",
  DERIVATIVE: "Derivative",
  CURRENCY: "Currency",
  BOND: "Bond",
  EVENT: "Event",
  CONCEPT: "Concept",
  PERSON: "Person",
  COUNTRY: "Country",
  LOCATION: "Location",
  INSTITUTION: "Institution",
  UNK: "Unclassified",
};

// Causal-type palette (colorblind-safe, adapted from Okabe-Ito).
// One color per relationship family so analysts can read the graph by
// meaning rather than sentiment. Same colors in light and dark themes.
export const CAUSAL_TYPE_COLORS: Record<string, string> = {
  CAUSAL: "#e69f00",           // orange — "A drives / impacts / causes B"
  COMPETITIVE: "#d55e00",      // vermilion — "A competes with / outperforms B"
  CORPORATE_ACTION: "#009e73", // teal — "A acquires / launches / partners with B"
  FINANCIAL_METRIC: "#0072b2", // blue — "A reports / beats / generates B"
  STRUCTURAL: "#cc79a7",       // purple — "A is-a / has ticker / includes B"
  OPERATIONAL: "#56b4e9",      // sky — "A produces / uses / delivers B"
  REGULATORY: "#f0e442",       // yellow — "A sues / regulates / files against B"
  OTHER: "#94a3b8",            // slate — anything the classifier missed
};

// Brighter variants used when an edge is inside the focused neighborhood.
export const CAUSAL_TYPE_COLORS_BRIGHT: Record<string, string> = {
  CAUSAL: "#f4a923",
  COMPETITIVE: "#e87023",
  CORPORATE_ACTION: "#12b585",
  FINANCIAL_METRIC: "#1a8fce",
  STRUCTURAL: "#d992b6",
  OPERATIONAL: "#78c5ee",
  REGULATORY: "#f5e961",
  OTHER: "#cbd5e1",
};

// Human-readable labels for the causal-type legend / filter UI.
export const CAUSAL_TYPE_LABELS: Record<string, string> = {
  CAUSAL: "Causal",
  COMPETITIVE: "Competitive",
  CORPORATE_ACTION: "Corporate action",
  FINANCIAL_METRIC: "Financial metric",
  STRUCTURAL: "Structural",
  OPERATIONAL: "Operational",
  REGULATORY: "Regulatory",
  OTHER: "Other",
};

interface ThemePalette {
  textColor: string;
  textOutlineColor: string;
  defaultEdgeColor: string;
  nodeBorderColor: string;
  selectedBorderColor: string;
  hoveredEdgeColor: string;
}

const DARK: ThemePalette = {
  textColor: "#e4e4e7", // zinc-200
  textOutlineColor: "#09090b", // zinc-950
  defaultEdgeColor: "#52525b", // zinc-600
  nodeBorderColor: "#27272a", // zinc-800
  selectedBorderColor: "#fafafa", // zinc-50
  hoveredEdgeColor: "#a1a1aa", // zinc-400
};

const LIGHT: ThemePalette = {
  textColor: "#18181b", // zinc-900
  textOutlineColor: "#ffffff",
  defaultEdgeColor: "#a1a1aa", // zinc-400
  nodeBorderColor: "#e4e4e7", // zinc-200
  selectedBorderColor: "#09090b", // zinc-950
  hoveredEdgeColor: "#52525b", // zinc-600
};

export function makeGraphStyles(isDark: boolean): StylesheetJson {
  const p = isDark ? DARK : LIGHT;

  const causalTypeSelectors = Object.entries(CAUSAL_TYPE_COLORS).flatMap(
    ([type, color]) => [
      {
        selector: `edge[causal_type = "${type}"]`,
        style: {
          "line-color": color,
          "target-arrow-color": color,
          opacity: 0.75,
        },
      },
    ]
  );

  const causalTypeHighlightSelectors = Object.entries(
    CAUSAL_TYPE_COLORS_BRIGHT
  ).map(([type, color]) => ({
    selector: `edge.highlighted[causal_type = "${type}"]`,
    style: {
      "line-color": color,
      "target-arrow-color": color,
    },
  }));

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
    // type-specific colors — one selector per entity type
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
        opacity: 0.55,
        // Edge label — the extracted verb, rotated along the edge. Hidden
        // by default so dense graphs stay readable; the label pops on
        // hover (see the .hovered rule below).
        label: "data(rel)",
        "font-size": 6,
        color: p.textColor,
        "text-opacity": 0,
        "text-outline-color": p.textOutlineColor,
        "text-outline-width": 1,
        "text-outline-opacity": 0,
        "text-rotation": "autorotate",
        "text-margin-y": -3,
      },
    },
    // Color by causal type (primary edge signal)
    ...causalTypeSelectors,
    // Prediction edges are drawn dashed regardless of causal type;
    // colors remain so the meaning still reads.
    {
      selector: 'edge[origin = "prediction"]',
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [6, 3],
      },
    },
    {
      selector: "edge.hovered",
      style: {
        "line-color": p.hoveredEdgeColor,
        "target-arrow-color": p.hoveredEdgeColor,
        opacity: 1,
        "z-index": 99,
        // Label reveals on hover — same 6px as the default rule so it
        // doesn't grow / jump. Outlined so it stays readable over other
        // edges and node fills.
        "font-size": 6,
        "text-opacity": 1,
        "text-outline-width": 1.5,
        "text-outline-opacity": 1,
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
    ...causalTypeHighlightSelectors,
  ];
}

// Back-compat default export — uses dark theme. Prefer makeGraphStyles().
export const graphStyles = makeGraphStyles(true);
