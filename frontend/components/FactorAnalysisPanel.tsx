"use client";

// Factor Analysis tab — sibling of the Knowledge graph and Predictions
// tabs. Reads sources/<id>/factors/latest.json produced by the daily
// factor-model runner. Renders:
//   • A PC1×PC2 scatter of entities, coloured by KMeans cluster
//   • Cluster archetype cards on the right
//   • A footer with the raw variance-explained + kept-factor list

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { fetchFactorsLatest } from "@/lib/api/client";
import type { FactorEntity, FactorsFile } from "@/lib/api/types";
import { ENTITY_COLORS } from "@/components/graphStyles";

interface FactorAnalysisViewProps {
  sourceId: string;
}

// Collapsed-state persistence for the explainer, mirroring the
// Predictions about-box: default collapsed, choice remembered per browser.
const ABOUT_COLLAPSED_STORAGE_KEY = "eibkg.factors.about.collapsed";

/** Cluster palette — muted, consistent with the rest of the UI. */
const CLUSTER_COLORS = [
  "#059669", // emerald
  "#71717a", // slate
  "#0284c7", // sky
  "#d97706", // amber
  "#be123c", // rose
  "#7c3aed", // violet (reserved; palette only extends this far when k>5)
  "#0f766e", // teal
];

function clusterColor(c: number): string {
  return CLUSTER_COLORS[c % CLUSTER_COLORS.length];
}

function factorTitle(name: string): string {
  return {
    attention: "Attention",
    sentiment: "Sentiment",
    consensus: "Consensus",
    novelty: "Novelty",
    materiality: "Materiality",
  }[name] ?? name;
}

interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function computeBounds(entities: FactorEntity[]): Bounds {
  if (!entities.length) return { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
  const xs = entities.map((e) => e.pc1);
  const ys = entities.map((e) => e.pc2);
  const pad = 0.15;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xr = xMax - xMin || 1;
  const yr = yMax - yMin || 1;
  return {
    xMin: xMin - xr * pad,
    xMax: xMax + xr * pad,
    yMin: yMin - yr * pad,
    yMax: yMax + yr * pad,
  };
}

/** Collapsible "What this is" explainer. Default collapsed; the choice is
 *  remembered per browser (same pattern as the Predictions about-box). */
function AboutStrip() {
  const [collapsed, setCollapsed] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem(ABOUT_COLLAPSED_STORAGE_KEY);
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
    <div className="shrink-0 border-b border-border/60 bg-muted/20 px-6 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 text-left font-medium text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        What this is — and how the clusters are built
      </button>
      {!collapsed && (
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pb-1 pr-2">
          <p>
            Every entity is scored on five news factors from the LLM-extracted
            relationships:{" "}
            <span className="text-foreground">Attention</span> (coverage
            volume), <span className="text-foreground">Sentiment</span> (mean
            tone), <span className="text-foreground">Consensus</span> (do
            sources agree — 1 − sentiment spread),{" "}
            <span className="text-foreground">Novelty</span> (share of
            counterparties unique to it), and{" "}
            <span className="text-foreground">Materiality</span> (log of
            extracted dollar amounts). Point size ≈ mention count; hover a
            point for its full loading vector.
          </p>
          <p>
            <span className="font-medium text-foreground">Clustering.</span>{" "}
            Each factor is standardized to z-scores (so &ldquo;+0.9
            consensus&rdquo; means 0.9 standard deviations above the corpus
            average), then KMeans groups entities in the full 5-factor space:
            it places k centroids, assigns each entity to the nearest one,
            moves each centroid to its members&rsquo; average, and repeats
            until stable. A cluster card&rsquo;s signature is its
            centroid&rsquo;s three strongest factors — an{" "}
            <em>archetype</em> of news posture (e.g. Attention+ · Consensus−
            = heavily covered, contested story), not anything the model was
            told about the companies.
          </p>
          <p>
            <span className="font-medium text-foreground">
              The scatter is only a map.
            </span>{" "}
            PCA projects the 5 factors onto the 2 directions of greatest
            variance for display; clustering happened in the full space, so
            two nearby points can belong to different clusters. Trust the
            colors over the distances. Factors reflect the current rolling
            news window, so clusters drift as coverage changes.
          </p>
        </div>
      )}
    </div>
  );
}

function Scatter({ entities }: { entities: FactorEntity[] }) {
  const W = 640, H = 420;
  const M = { top: 20, right: 24, bottom: 40, left: 40 };
  const b = useMemo(() => computeBounds(entities), [entities]);
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  const px = (x: number) => M.left + ((x - b.xMin) / (b.xMax - b.xMin)) * (W - M.left - M.right);
  const py = (y: number) => H - M.bottom - ((y - b.yMin) / (b.yMax - b.yMin)) * (H - M.top - M.bottom);
  const originX = px(0);
  const originY = py(0);

  // Permanent point labels with greedy collision avoidance: highest-
  // attention entities claim label space first; each label tries right /
  // left / above / below of its dot and takes the first spot that doesn't
  // overlap an already-placed label (falling back to "right" so every
  // point stays named). Long names are truncated — hover shows the full
  // name via the bold overlay + native tooltip.
  const LABEL_MAX_CHARS = 18;
  const pointLabels = useMemo(() => {
    const pxl = (x: number) =>
      M.left + ((x - b.xMin) / (b.xMax - b.xMin)) * (W - M.left - M.right);
    const pyl = (y: number) =>
      H - M.bottom - ((y - b.yMin) / (b.yMax - b.yMin)) * (H - M.top - M.bottom);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (a: (typeof placed)[0], c: (typeof placed)[0]) =>
      a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y;
    const out: { name: string; text: string; x: number; y: number; anchor: string }[] = [];
    const ents = [...entities].sort((a, z) => z.n_articles - a.n_articles);
    for (const e of ents) {
      const cx = pxl(e.pc1);
      const cy = pyl(e.pc2);
      const r = 4 + Math.min(4, e.n_articles - 2);
      const text =
        e.name.length > LABEL_MAX_CHARS
          ? `${e.name.slice(0, LABEL_MAX_CHARS - 1)}…`
          : e.name;
      const w = text.length * 5.1;
      const h = 10;
      const candidates = [
        { x: cx + r + 4, y: cy + 3, anchor: "start" },
        { x: cx - r - 4, y: cy + 3, anchor: "end" },
        { x: cx, y: cy - r - 5, anchor: "middle" },
        { x: cx, y: cy + r + 11, anchor: "middle" },
      ];
      let chosen = candidates[0];
      for (const c of candidates) {
        const bx =
          c.anchor === "start" ? c.x : c.anchor === "end" ? c.x - w : c.x - w / 2;
        const box = { x: bx, y: c.y - h + 2, w, h };
        if (box.x < 2 || box.x + w > W - 2 || box.y < 2) continue;
        if (!placed.some((p) => overlaps(p, box))) {
          chosen = c;
          break;
        }
      }
      const bx =
        chosen.anchor === "start"
          ? chosen.x
          : chosen.anchor === "end"
            ? chosen.x - w
            : chosen.x - w / 2;
      placed.push({ x: bx, y: chosen.y - h + 2, w, h });
      out.push({ name: e.name, text, ...chosen });
    }
    return out;
  }, [entities, b]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full">
      <rect
        x={M.left}
        y={M.top}
        width={W - M.left - M.right}
        height={H - M.top - M.bottom}
        fill="transparent"
        stroke="currentColor"
        strokeOpacity={0.1}
      />
      <line x1={M.left} x2={W - M.right} y1={originY} y2={originY}
        stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 3" />
      <line x1={originX} x2={originX} y1={M.top} y2={H - M.bottom}
        stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 3" />
      <text x={W - M.right - 4} y={originY - 6} textAnchor="end"
        className="fill-current text-[10px] font-mono opacity-70">
        PC1 →
      </text>
      <text x={originX + 6} y={M.top + 12}
        className="fill-current text-[10px] font-mono opacity-70">
        PC2 ↑
      </text>

      {/* Points — dots always, labels only for the hovered entity so
          nearby clusters don't collide. The <title> gives every dot a
          native tooltip on hover as well. */}
      {entities.map((e) => {
        const cx = px(e.pc1);
        const cy = py(e.pc2);
        const isHovered = hoveredName === e.name;
        return (
          <g key={e.name}>
            <circle
              cx={cx}
              cy={cy}
              r={4 + Math.min(4, e.n_articles - 2)}
              fill={clusterColor(e.cluster)}
              fillOpacity={isHovered ? 1 : 0.85}
              stroke={isHovered ? "currentColor" : "none"}
              strokeWidth={isHovered ? 1.5 : 0}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredName(e.name)}
              onMouseLeave={() => setHoveredName(null)}
            >
              <title>
                {`${e.name} — ${e.type}\ncluster ${e.cluster} · ${e.n_articles} articles\nattention ${e.factors.attention.toFixed(1)} · sentiment ${e.factors.sentiment.toFixed(2)} · consensus ${e.factors.consensus.toFixed(2)} · novelty ${e.factors.novelty.toFixed(2)} · materiality ${e.factors.materiality.toFixed(1)}`}
              </title>
            </circle>
          </g>
        );
      })}
      {/* Permanent name labels (collision-avoided; hover overlay handles
          the emphasized full name) */}
      {pointLabels.map((l) =>
        l.name === hoveredName ? null : (
          <text
            key={l.name}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor as "start" | "end" | "middle"}
            className="fill-current text-[8.5px]"
            opacity={0.75}
            pointerEvents="none"
            style={{
              paintOrder: "stroke",
              stroke: "var(--background, #fff)",
              strokeWidth: 2.5,
            }}
          >
            {l.text}
          </text>
        )
      )}
      {/* Draw the hovered-entity label last so it sits on top of every dot */}
      {hoveredName && (() => {
        const h = entities.find((e) => e.name === hoveredName);
        if (!h) return null;
        const cx = px(h.pc1), cy = py(h.pc2);
        const anchor = cx > (W - M.right - 100) ? "end" : "start";
        const dx = anchor === "end" ? -8 : 8;
        return (
          <text
            x={cx + dx}
            y={cy - 8}
            textAnchor={anchor}
            className="fill-current text-[11px] font-semibold"
            pointerEvents="none"
            style={{ paintOrder: "stroke", stroke: "var(--background, #fff)", strokeWidth: 3 }}
          >
            {h.name}
          </text>
        );
      })()}
    </svg>
  );
}

function ClusterCard({
  cluster,
  size,
  signature,
  members,
}: {
  cluster: number;
  size: number;
  signature: Array<{ factor: string; loading: number }>;
  members: string[];
}) {
  const color = clusterColor(cluster);
  const sigText = signature
    .map((s) => `${factorTitle(s.factor)}${s.loading > 0 ? "+" : "−"}`)
    .join(" · ");
  return (
    <div className="rounded-md border border-border/70 bg-background p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-semibold">Cluster {cluster}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {size} entities
        </span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{sigText}</div>
      <div className="mt-1.5 text-[10px] leading-snug">
        {members.slice(0, 8).join(" · ")}
        {members.length > 8 && ` · +${members.length - 8} more`}
      </div>
    </div>
  );
}

export function FactorAnalysisView({ sourceId }: FactorAnalysisViewProps) {
  const [data, setData] = useState<FactorsFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    setData(null);
    setError(null);
    fetchFactorsLatest(sourceId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sourceId]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2 font-mono text-[10px] text-muted-foreground">
        <span>
          {data ? (
            <>
              Factor loadings for{" "}
              <span className="text-foreground">{data.date}</span>
              {" — "}
              {data.entities.length} entities, k={data.kmeans.k}
            </>
          ) : (
            "Loading factor bundle…"
          )}
        </span>
        {data && (
          <span>
            PCA variance:{" "}
            {data.pca.explained_variance
              .map((v) => `${(v * 100).toFixed(0)}%`)
              .join(" · ")}
          </span>
        )}
      </div>

      {/* Explainer strip — collapsible, default collapsed */}
      <AboutStrip />

      {error && (
        <div className="px-6 py-6 text-xs text-destructive">
          Failed to load factor bundle: {error}
        </div>
      )}

      {!error && !data && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Loading factor bundle…
        </div>
      )}

      {data && data.entities.length === 0 && (
        <div className="px-6 py-6 text-xs text-muted-foreground">
          Factor bundle exists but no entities passed the min-articles
          threshold. Wait for a busier news day, or reduce the threshold in{" "}
          <span className="font-mono">run_daily_factors.py</span>.
        </div>
      )}

      {data && data.entities.length > 0 && (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-4">
            <Scatter entities={data.entities} />
          </div>
          <div className="w-72 shrink-0 space-y-2 overflow-y-auto border-l border-border/60 px-4 py-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Archetype clusters
            </div>
            {data.kmeans.clusters.map((c) => (
              <ClusterCard
                key={c.cluster}
                cluster={c.cluster}
                size={c.size}
                signature={c.signature}
                members={c.members}
              />
            ))}
            <div className="pt-2 text-[10px] leading-snug text-muted-foreground">
              Factors kept:{" "}
              <span className="font-mono">
                {data.kept_factors.map(factorTitle).join(" · ")}
              </span>
              {ENTITY_COLORS ? null : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
