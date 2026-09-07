"use client";

// Factor Analysis tab — sibling of the Knowledge graph and Predictions
// tabs. Reads sources/<id>/factors/latest.json produced by the daily
// factor-model runner. Renders:
//   • A PC1×PC2 scatter of entities, coloured by KMeans cluster
//   • Cluster archetype cards on the right
//   • A footer with the raw variance-explained + kept-factor list

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { fetchFactorsIndex, fetchFactorsLatest } from "@/lib/api/client";
import type { FactorEntity, FactorsFile } from "@/lib/api/types";
import { ENTITY_COLORS, entityLabel } from "@/components/graphStyles";

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

/** Canonical factor order — signatures always list and key traits in this
 *  sequence, never by strength. */
const FACTOR_ORDER = [
  "attention",
  "sentiment",
  "consensus",
  "novelty",
  "materiality",
];

/** Semantic cluster colors: a color is a deterministic function of the
 *  cluster's FULL trait combination (all signature factors with their
 *  signs, in canonical order). The same combination — e.g. Consensus+ ·
 *  Novelty+ · Materiality+ — therefore maps to the same color on every
 *  date of the timeline, and any different combination maps to a
 *  different hue. Companies change color only when their cluster's
 *  combination changes, never because KMeans renumbered its clusters. */
function signatureKey(
  signature: Array<{ factor: string; loading: number }>
): string {
  return [...signature]
    .sort(
      (a, b) => FACTOR_ORDER.indexOf(a.factor) - FACTOR_ORDER.indexOf(b.factor)
    )
    .map((s) => `${s.factor}${s.loading > 0 ? "+" : "-"}`)
    .join("|");
}

function signatureColor(
  signature: Array<{ factor: string; loading: number }>
): string {
  // Exact enumeration, no hashing: each factor is absent (0), positive
  // (1) or negative (2) in the signature, giving every possible
  // combination a unique base-3 index (3^5 = 243). Golden-angle spacing
  // over that index yields a distinct, stable hue for each — provably
  // collision-free, so "different combinations, different colors" holds
  // for the entire signature space, forever.
  let index = 0;
  for (let i = 0; i < FACTOR_ORDER.length; i++) {
    const entry = signature.find((s) => s.factor === FACTOR_ORDER[i]);
    const state = entry == null ? 0 : entry.loading > 0 ? 1 : 2;
    index = index * 3 + state;
  }
  const hue = (index * 137.508) % 360;
  const light = 38 + (index % 4) * 4; // 38–50%: extra separation for near hues
  return `hsl(${hue.toFixed(1)}, 62%, ${light}%)`;
}

function buildClusterColors(
  clusters: Array<{
    cluster: number;
    signature: Array<{ factor: string; loading: number }>;
  }>
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of clusters) {
    out[c.cluster] = signatureColor(c.signature);
  }
  return out;
}

type Sig = Array<{ factor: string; loading: number }>;

/** Plain-English reading of a cluster signature, composed per trait in
 *  canonical order — "Consensus+ · Materiality+ · Attention−" becomes
 *  "flying under the radar, sources in agreement, big money on the
 *  table". */
const TRAIT_PHRASES: Record<string, [string, string]> = {
  attention: ["heavily covered", "flying under the radar"],
  sentiment: ["getting positive press", "getting negative press"],
  consensus: ["sources in agreement", "a contested storyline"],
  novelty: [
    "driving its own storylines",
    "mentioned in others' stories rather than its own",
  ],
  materiality: ["big money on the table", "little money at stake"],
};

function describeSignature(signature: Sig): string {
  const parts = [...signature]
    .sort(
      (a, b) => FACTOR_ORDER.indexOf(a.factor) - FACTOR_ORDER.indexOf(b.factor)
    )
    .map((sg) => TRAIT_PHRASES[sg.factor]?.[sg.loading > 0 ? 0 : 1])
    .filter(Boolean);
  if (parts.length === 0) return "";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
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
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pb-1 pr-2">
          <p>
            <span className="font-medium text-foreground">
              What this tab is for.
            </span>{" "}
            It answers &ldquo;who is in the news, how is the press treating
            them, and which names are behaving alike?&rdquo; — without
            reading hundreds of articles. Instead of headlines, every
            company and topic gets a news profile, and similar profiles are
            grouped so unusual behaviour stands out.
          </p>
          <div>
            <span className="font-medium text-foreground">
              The five factors
            </span>{" "}
            are five simple questions asked of each entity&rsquo;s recent
            coverage:
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              <li>
                <span className="text-foreground">Attention</span> — how much
                is it being written about?
              </li>
              <li>
                <span className="text-foreground">Sentiment</span> — is the
                tone positive or negative?
              </li>
              <li>
                <span className="text-foreground">Consensus</span> — do
                sources agree, or is the story contested?
              </li>
              <li>
                <span className="text-foreground">Novelty</span> — is it
                generating its own storylines, or only appearing in
                others&rsquo;?
              </li>
              <li>
                <span className="text-foreground">Materiality</span> — how
                much money do its stories involve (deal sizes, fines,
                revenue figures)?
              </li>
            </ul>
          </div>
          <p>
            <span className="font-medium text-foreground">
              The clusters
            </span>{" "}
            group entities that answer those five questions the same way —
            think of them as news <em>personalities</em>&nbsp;found
            automatically (by KMeans, a standard grouping algorithm), with no
            labels or sector information given to it. Each card names the
            personality&rsquo;s defining traits: &ldquo;Attention+ ·
            Consensus−&rdquo; reads as <em>heavily covered, contested
            story</em>&nbsp;— names to watch; &ldquo;Materiality+ ·
            Sentiment+&rdquo; is <em>big money moving on good news</em>. The
            practical use: scan the cards to see which regime each name is
            in, and notice when a company sits in a different cluster than
            its peers — that&rsquo;s the anomaly worth a closer look.
          </p>
          <p>
            <span className="font-medium text-foreground">
              The scatter is just the map.
            </span>{" "}
            Five scores can&rsquo;t be drawn on a screen, so a standard
            technique (PCA) flattens them onto two axes while preserving as
            much of the differences between entities as possible. Points
            near each other have similar news profiles; colors are the
            clusters, and each color is keyed to the cluster&rsquo;s full
            trait combination — the same combination (say Consensus+ ·
            Novelty+ · Materiality+) is the same color at every date on
            the timeline, a different combination is a different color,
            and a company changes color only when its news personality
            changes.
            Because the map is a flattened view, trust the colors over the
            distances. Profiles reflect the current rolling news
            window, so the picture shifts as coverage changes — that&rsquo;s
            by design for a live corpus. Point size ≈ mention count; hover
            any point for its exact scores.
          </p>
        </div>
      )}
    </div>
  );
}

function Scatter({
  entities,
  clusterColors,
  highlightCluster,
  onHoverCluster,
  onTogglePin,
}: {
  entities: FactorEntity[];
  clusterColors: Record<number, string>;
  /** null = no focus; a cluster index = highlight it, dim the rest;
   *  -1 = a pinned archetype absent on this date, dim everything. */
  highlightCluster: number | null;
  /** Hovering a dot highlights its whole cluster (label + siblings). */
  onHoverCluster?: (cluster: number | null) => void;
  /** Clicking a dot pins/unpins its cluster, same as the sidebar card. */
  onTogglePin?: (cluster: number) => void;
}) {
  const W = 640, H = 420;
  const M = { top: 20, right: 24, bottom: 40, left: 40 };
  const b = useMemo(() => computeBounds(entities), [entities]);

  // Zoom + pan: the viewBox is the camera. Wheel zooms about the cursor
  // (everything — dots AND labels — renders larger, which is what makes
  // overlapping labels readable); dragging pans. Reset restores the full
  // frame. Attached via a native non-passive listener because React's
  // onWheel can't preventDefault page scroll.
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: W, h: H });
  const isZoomed = view.w < W - 0.5;
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((v) => {
        const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        const newW = Math.min(W, Math.max(W / 10, v.w * factor));
        if (newW === v.w) return v;
        const scale = newW / v.w;
        const mx = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
        const my = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
        const newH = v.h * scale;
        return {
          x: mx - (mx - v.x) * scale,
          y: my - (my - v.y) * scale,
          w: newW,
          h: newH,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isZoomed) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = panRef.current;
    const svg = svgRef.current;
    if (!st || !svg) return;
    const rect = svg.getBoundingClientRect();
    setView((v) => ({
      ...v,
      x: st.vx - ((e.clientX - st.startX) / rect.width) * v.w,
      y: st.vy - ((e.clientY - st.startY) / rect.height) * v.h,
    }));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    panRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

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
  // Zoom scale: labels are drawn at a constant *screen* size (their SVG
  // footprint shrinks by `zs` as the camera zooms in), so zooming spreads
  // the dots apart while the text stays the same size on screen — the
  // collision solver reruns at each zoom level and overlapping names
  // resolve. At full frame zs = 1 and nothing changes.
  const zs = view.w / W;
  const pointLabels = useMemo(() => {
    const pxl = (x: number) =>
      M.left + ((x - b.xMin) / (b.xMax - b.xMin)) * (W - M.left - M.right);
    const pyl = (y: number) =>
      H - M.bottom - ((y - b.yMin) / (b.yMax - b.yMin)) * (H - M.top - M.bottom);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (a: (typeof placed)[0], c: (typeof placed)[0]) =>
      a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y;
    const out: { name: string; text: string; x: number; y: number; anchor: string; cluster: number }[] = [];
    const ents = [...entities].sort((a, z) => z.n_articles - a.n_articles);
    for (const e of ents) {
      const cx = pxl(e.pc1);
      const cy = pyl(e.pc2);
      // Dot radius damped by sqrt(zs): dots grow on zoom but slower than
      // the spacing, so deep zoom separates points instead of inflating
      // them into planets.
      const r = (4 + Math.min(4, e.n_articles - 2)) * Math.sqrt(zs);
      const text =
        e.name.length > LABEL_MAX_CHARS
          ? `${e.name.slice(0, LABEL_MAX_CHARS - 1)}…`
          : e.name;
      const w = text.length * 5.1 * zs;
      const h = 10 * zs;
      const candidates = [
        { x: cx + r + 4 * zs, y: cy + 3 * zs, anchor: "start" },
        { x: cx - r - 4 * zs, y: cy + 3 * zs, anchor: "end" },
        { x: cx, y: cy - r - 5 * zs, anchor: "middle" },
        { x: cx, y: cy + r + 11 * zs, anchor: "middle" },
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
      out.push({ name: e.name, text, ...chosen, cluster: e.cluster });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, b, zs]);

  return (
    <div
      className="relative max-h-full max-w-full"
      style={{ aspectRatio: `${W} / ${H}`, width: "100%" }}
    >
      <div className="pointer-events-none absolute right-2 top-1 z-10 flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground/70">
          scroll to zoom{isZoomed ? " · drag to pan" : ""}
        </span>
        {isZoomed && (
          <button
            type="button"
            onClick={() => setView({ x: 0, y: 0, w: W, h: H })}
            className="pointer-events-auto rounded-md border border-border bg-background/90 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground transition hover:text-foreground"
          >
            Reset view
          </button>
        )}
      </div>
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="h-full w-full"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        touchAction: "none",
        cursor: isZoomed ? (panRef.current ? "grabbing" : "grab") : "default",
      }}
    >
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
        return (
          <g key={e.name}>
            <circle
              cx={cx}
              cy={cy}
              r={(4 + Math.min(4, e.n_articles - 2)) * Math.sqrt(zs)}
              fill={clusterColors[e.cluster] ?? clusterColor(e.cluster)}
              fillOpacity={
                highlightCluster != null && e.cluster !== highlightCluster
                  ? 0.12
                  : 0.85
              }
              stroke="none"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => onHoverCluster?.(e.cluster)}
              onMouseLeave={() => onHoverCluster?.(null)}
              onClick={() => onTogglePin?.(e.cluster)}
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
      {pointLabels.map((l) => (
          <text
            key={l.name}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor as "start" | "end" | "middle"}
            className="fill-current"
            opacity={
              highlightCluster != null && l.cluster !== highlightCluster
                ? 0.1
                : 0.75
            }
            pointerEvents="none"
            style={{
              fontSize: 8.5 * zs,
              paintOrder: "stroke",
              stroke: "var(--background, #fff)",
              strokeWidth: 2.5 * zs,
            }}
          >
            {l.text}
          </text>
      ))}

    </svg>
    </div>
  );
}

function ClusterCard({
  cluster,
  size,
  signature,
  members,
  color,
  hovered,
  onHover,
}: {
  cluster: number;
  size: number;
  signature: Sig;
  members: string[];
  color: string;
  hovered?: boolean;
  onHover?: (cluster: number | null) => void;
}) {
  // Fixed canonical order (not by strength): every card lists its traits
  // in the same factor sequence, matching the order the color key uses.
  const sigText = [...signature]
    .sort(
      (a, b) => FACTOR_ORDER.indexOf(a.factor) - FACTOR_ORDER.indexOf(b.factor)
    )
    .map((s) => `${factorTitle(s.factor)}${s.loading > 0 ? "+" : "−"}`)
    .join(" · ");
  return (
    <div
      className={
        "rounded-md border bg-background p-2.5 transition-colors " +
        (hovered ? "border-foreground/40" : "border-border/70")
      }
      onMouseEnter={() => onHover?.(cluster)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1 text-[11px] font-semibold leading-snug">
          {sigText}
        </span>
        <span className="ml-auto shrink-0 self-start font-mono text-[10px] text-muted-foreground">
          {size} {size === 1 ? "entity" : "entities"}
        </span>
      </div>
      <div className="mt-1 text-[10px] italic leading-snug text-muted-foreground">
        {describeSignature(signature)}
      </div>
      <div className="mt-1.5 text-[10px] leading-snug">
        {members.slice(0, 8).join(" · ")}
        {members.length > 8 && ` · +${members.length - 8} more`}
      </div>
    </div>
  );
}

/** Placeholder for an archetype that exists elsewhere on the timeline but
 *  has no entities on the selected date — kept in place (same order,
 *  dimmed) so the sidebar never reshuffles as the user scrubs. */
function GhostClusterCard({ signature }: { signature: Sig }) {
  const sigText = [...signature]
    .sort(
      (a, b) => FACTOR_ORDER.indexOf(a.factor) - FACTOR_ORDER.indexOf(b.factor)
    )
    .map((sg) => `${factorTitle(sg.factor)}${sg.loading > 0 ? "+" : "−"}`)
    .join(" · ");
  return (
    <div className="rounded-md border border-border/40 bg-background p-2.5 opacity-40">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: signatureColor(signature) }}
        />
        <span className="min-w-0 flex-1 text-[11px] font-semibold leading-snug">
          {sigText}
        </span>
        <span className="ml-auto shrink-0 self-start font-mono text-[10px] text-muted-foreground">
          —
        </span>
      </div>
      <div className="mt-1 text-[10px] italic leading-snug text-muted-foreground">
        {describeSignature(signature)} No names here on this date.
      </div>
    </div>
  );
}

/** Draggable single-value date scrubber over the dated factor bundles. */
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function DateScrubber({
  dates,
  value,
  onChange,
}: {
  dates: string[];
  value: string;
  onChange: (d: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // While dragging, the thumb follows the pointer continuously and snaps
  // to its cell on release — same feel as the main timeline scrubber.
  const [livePct, setLivePct] = useState<number | null>(null);
  const idx = Math.max(0, dates.indexOf(value));
  const cellW = 100 / dates.length;

  const pick = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setLivePct(Math.min(100 - cellW, Math.max(0, frac * 100 - cellW / 2)));
    const i = Math.min(dates.length - 1, Math.floor(frac * dates.length));
    if (dates[i] !== value) onChange(dates[i]);
  };

  const endDrag = (e: React.PointerEvent) => {
    draggingRef.current = false;
    setLivePct(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  // First date of each month gets a full-height tick + a label; every
  // date gets a minor tick while the axis is sparse enough to read them.
  const monthStarts = dates
    .map((d, i) => ({ d, i }))
    .filter(({ d }, j) => j === 0 || dates[j - 1].slice(0, 7) !== d.slice(0, 7));
  const showMinorTicks = dates.length <= 90;

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border/60 px-6 py-2.5">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => idx > 0 && onChange(dates[idx - 1])}
        className="rounded border border-border px-1.5 font-mono text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-30"
        disabled={idx === 0}
      >
        ‹
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={dates.length - 1}
          aria-valuenow={idx}
          aria-valuetext={value}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            draggingRef.current = true;
            pick(e.clientX);
          }}
          onPointerMove={(e) => draggingRef.current && pick(e.clientX)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" && idx > 0) onChange(dates[idx - 1]);
            if (e.key === "ArrowRight" && idx < dates.length - 1)
              onChange(dates[idx + 1]);
          }}
          className="relative h-4 w-full shrink-0 cursor-pointer overflow-hidden rounded-full border border-border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ touchAction: "none" }}
        >
          {showMinorTicks &&
            dates.map((d, i) =>
              i === 0 ? null : (
                <div
                  key={d}
                  className="pointer-events-none absolute bottom-0 h-1 w-px bg-border"
                  style={{ left: `${i * cellW}%` }}
                />
              )
            )}
          {monthStarts.map(({ d, i }) =>
            i === 0 ? null : (
              <div
                key={`m-${d}`}
                className="pointer-events-none absolute top-0 h-full w-px bg-foreground/25"
                style={{ left: `${i * cellW}%` }}
              />
            )
          )}
          <div
            className={`absolute top-0 h-full rounded-full border border-foreground/40 bg-foreground/15 ${
              livePct === null ? "transition-[left] duration-100" : ""
            }`}
            style={{
              left: `${livePct ?? idx * cellW}%`,
              width: `${cellW}%`,
            }}
          />
        </div>
        <div className="pointer-events-none relative h-3 overflow-hidden font-mono text-[9px] leading-3 text-muted-foreground">
          {monthStarts.map(({ d, i }, j) => (
            <span
              key={`l-${d}`}
              className="absolute whitespace-nowrap"
              style={{ left: `${i * cellW}%` }}
            >
              {MONTH_ABBR[parseInt(d.slice(5, 7), 10) - 1]}
              {(j === 0 || d.slice(0, 4) !== monthStarts[j - 1].d.slice(0, 4)) &&
                ` ${d.slice(0, 4)}`}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label="Next day"
        onClick={() => idx < dates.length - 1 && onChange(dates[idx + 1])}
        className="rounded border border-border px-1.5 font-mono text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-30"
        disabled={idx === dates.length - 1}
      >
        ›
      </button>
      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

export function FactorAnalysisView({ sourceId }: FactorAnalysisViewProps) {
  const [data, setData] = useState<FactorsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable semantic colors for this bundle's clusters (see
  // FACTOR_SIGN_COLORS): recomputed per date, but a given color always
  // encodes the same dominant trait.
  const clusterColors = useMemo(
    () => (data ? buildClusterColors(data.kmeans.clusters) : {}),
    [data]
  );

  // History scrubber: dated bundles from factors/index.json; null date =
  // latest.
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Entity-type filter for the scatter (clutter control). Types are
  // hidden by clicking their chip; empty set = show everything.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  // Cluster focus: hover is transient (by this date's cluster index),
  // a click pins the archetype by signature key so the highlight
  // survives timeline scrubbing.
  const [hoverCluster, setHoverCluster] = useState<number | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  // Stable archetype catalog: every signature seen on ANY date of this
  // source's timeline, in one fixed order — the sidebar renders from
  // this so cards never reshuffle while scrubbing.
  const [catalog, setCatalog] = useState<Array<{
    key: string;
    signature: Sig;
  }> | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    setDates([]);
    setSelectedDate(null);
    setHiddenTypes(new Set());
    setPinnedKey(null);
    setCatalog(null);
    fetchFactorsIndex(sourceId).then(setDates);
  }, [sourceId]);

  // Build the archetype catalog by sweeping every dated bundle once in
  // the background (bundles are small, CDN-cached static JSON).
  useEffect(() => {
    if (!sourceId || dates.length === 0) return;
    let cancelled = false;
    (async () => {
      const seen = new Map<string, Sig>();
      for (const d of dates) {
        if (cancelled) return;
        try {
          const b = await fetchFactorsLatest(sourceId, d);
          for (const c of b.kmeans.clusters) {
            const k = signatureKey(c.signature);
            if (!seen.has(k)) seen.set(k, c.signature);
          }
        } catch {
          /* a missing date never blocks the catalog */
        }
      }
      if (!cancelled) {
        setCatalog(
          [...seen.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([key, signature]) => ({ key, signature }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, dates]);

  // Entity-type counts for the filter chips; scatter shows only
  // non-hidden types.
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.entities ?? []) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const visibleEntities = useMemo(
    () => (data?.entities ?? []).filter((e) => !hiddenTypes.has(e.type)),
    [data, hiddenTypes]
  );
  // Resolve the cluster to highlight: hover wins (transient), else the
  // pinned archetype resolved against THIS date's clusters (-1 when the
  // archetype has no entities today, which dims the whole map).
  const highlightCluster = useMemo(() => {
    if (hoverCluster != null) return hoverCluster;
    if (pinnedKey == null || !data) return null;
    const hit = data.kmeans.clusters.find(
      (c) => signatureKey(c.signature) === pinnedKey
    );
    return hit ? hit.cluster : -1;
  }, [hoverCluster, pinnedKey, data]);

  // Stale-while-revalidate: scrubbing dates keeps the current chart on
  // screen while the next bundle loads (bundles are cached client-side,
  // so revisited dates swap in instantly). Only a source switch blanks
  // the panel — the old corpus's chart would be plain wrong. The seq
  // counter drops out-of-order responses from fast scrubs.
  const seqRef = useRef(0);
  const prevSourceRef = useRef<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (!sourceId) return;
    const seq = ++seqRef.current;
    if (prevSourceRef.current !== sourceId) {
      prevSourceRef.current = sourceId;
      setData(null);
    }
    setIsFetching(true);
    setError(null);
    fetchFactorsLatest(sourceId, selectedDate ?? undefined)
      .then((d) => {
        if (seqRef.current === seq) setData(d);
      })
      .catch((e) => {
        if (seqRef.current === seq)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seqRef.current === seq) setIsFetching(false);
      });
  }, [sourceId, selectedDate]);

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
              {isFetching && (
                <Loader2 className="ml-2 inline h-3 w-3 animate-spin align-[-2px]" />
              )}
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

      {data && (
        // min-h-0 is load-bearing: without it this flex-1 row refuses to
        // shrink below its content height, the inner overflow scrollbars
        // never engage, and everything below the fold is silently clipped.
        // The scrubber lives outside the entity-count branch so an empty
        // date can never strand the user without a way to scrub back.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {data.entities.length > 0 ? (
              <>
                {typeCounts.length > 1 && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-4 py-1.5">
                    {typeCounts.map(([t, n]) => {
                      const off = hiddenTypes.has(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() =>
                            setHiddenTypes((prev) => {
                              const next = new Set(prev);
                              if (next.has(t)) next.delete(t);
                              else next.add(t);
                              return next;
                            })
                          }
                          title={off ? "Show this entity type" : "Hide this entity type"}
                          className={
                            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition " +
                            (off
                              ? "border-border/50 text-muted-foreground/50 line-through"
                              : "border-border text-foreground hover:bg-accent")
                          }
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor: ENTITY_COLORS[t] ?? "#9ca3af",
                              opacity: off ? 0.4 : 0.9,
                            }}
                          />
                          {entityLabel(t)}
                          <span className="font-mono text-muted-foreground">
                            {n}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div
                  className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 transition-opacity duration-150"
                  style={{ opacity: isFetching ? 0.7 : 1 }}
                >
                  <Scatter
                    entities={visibleEntities}
                    clusterColors={clusterColors}
                    highlightCluster={highlightCluster}
                    onHoverCluster={setHoverCluster}
                    onTogglePin={(c) => {
                      const hit = data.kmeans.clusters.find(
                        (x) => x.cluster === c
                      );
                      if (!hit) return;
                      const k = signatureKey(hit.signature);
                      setPinnedKey((prev) => (prev === k ? null : k));
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center px-6 text-xs text-muted-foreground">
                Factor bundle exists but no entities passed the min-articles
                threshold. Wait for a busier news day, or reduce the
                threshold in{" "}
                <span className="font-mono">run_daily_factors.py</span>.
              </div>
            )}
            {dates.length > 1 && (
              <DateScrubber
                dates={dates}
                value={selectedDate ?? dates[dates.length - 1]}
                onChange={(d) =>
                  setSelectedDate(d === dates[dates.length - 1] ? null : d)
                }
              />
            )}
          </div>
          <div className="max-h-52 w-full shrink-0 space-y-2 overflow-y-auto border-t border-border/60 px-4 py-4 md:max-h-none md:w-72 md:border-l md:border-t-0">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Archetype clusters
            </div>
            {(() => {
              const currentByKey = new Map(
                data.kmeans.clusters.map((c) => [signatureKey(c.signature), c])
              );
              // Catalog rows (fixed order) + any of today's clusters the
              // background sweep hasn't seen yet.
              const base =
                catalog ??
                data.kmeans.clusters.map((c) => ({
                  key: signatureKey(c.signature),
                  signature: c.signature,
                }));
              const extras = data.kmeans.clusters
                .filter(
                  (c) => !base.some((r) => r.key === signatureKey(c.signature))
                )
                .map((c) => ({
                  key: signatureKey(c.signature),
                  signature: c.signature,
                }));
              const rows = [...base, ...extras].sort((a, b) =>
                a.key < b.key ? -1 : 1
              );
              return rows.map((r) => {
                const cur = currentByKey.get(r.key);
                const pinned = pinnedKey === r.key;
                if (!cur)
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setPinnedKey(pinned ? null : r.key)}
                      className={
                        "block w-full text-left " +
                        (pinned ? "rounded-md ring-1 ring-foreground/40" : "")
                      }
                    >
                      <GhostClusterCard signature={r.signature} />
                    </button>
                  );
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setPinnedKey(pinned ? null : r.key)}
                    className={
                      "block w-full text-left " +
                      (pinned ? "rounded-md ring-1 ring-foreground/40" : "")
                    }
                  >
                    <ClusterCard
                      cluster={cur.cluster}
                      size={cur.size}
                      signature={cur.signature}
                      members={cur.members}
                      color={
                        clusterColors[cur.cluster] ?? clusterColor(cur.cluster)
                      }
                      hovered={
                        hoverCluster === cur.cluster ||
                        (hoverCluster == null && pinned)
                      }
                      onHover={setHoverCluster}
                    />
                  </button>
                );
              });
            })()}
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
