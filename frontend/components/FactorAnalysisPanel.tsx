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
          <p>
            <span className="font-medium text-foreground">
              The five factors
            </span>{" "}
            are five simple questions asked of each entity&rsquo;s recent
            coverage: <span className="text-foreground">Attention</span> —
            how much is it being written about?{" "}
            <span className="text-foreground">Sentiment</span> — is the tone
            positive or negative?{" "}
            <span className="text-foreground">Consensus</span> — do sources
            agree, or is the story contested?{" "}
            <span className="text-foreground">Novelty</span>&nbsp;— is it
            generating its own storylines, or only appearing in
            others&rsquo;? <span className="text-foreground">Materiality</span>{" "}
            — how much money do its stories involve (deal sizes, fines,
            revenue figures)?
          </p>
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
            clusters. Because the map is a flattened view, trust the colors
            over the distances. Profiles reflect the current rolling news
            window, so the picture shifts as coverage changes — that&rsquo;s
            by design for a live corpus. Point size ≈ mention count; hover
            any point for its exact scores.
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
    const out: { name: string; text: string; x: number; y: number; anchor: string }[] = [];
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
      out.push({ name: e.name, text, ...chosen });
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
        const isHovered = hoveredName === e.name;
        return (
          <g key={e.name}>
            <circle
              cx={cx}
              cy={cy}
              r={(4 + Math.min(4, e.n_articles - 2)) * Math.sqrt(zs)}
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
            className="fill-current"
            opacity={0.75}
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
        )
      )}
      {/* Draw the hovered-entity label last so it sits on top of every dot */}
      {hoveredName && (() => {
        const h = entities.find((e) => e.name === hoveredName);
        if (!h) return null;
        const cx = px(h.pc1), cy = py(h.pc2);
        const anchor = cx > (W - M.right - 100) ? "end" : "start";
        const dx = anchor === "end" ? -8 * zs : 8 * zs;
        return (
          <text
            x={cx + dx}
            y={cy - 8 * zs}
            textAnchor={anchor}
            className="fill-current font-semibold"
            pointerEvents="none"
            style={{
              fontSize: 11 * zs,
              paintOrder: "stroke",
              stroke: "var(--background, #fff)",
              strokeWidth: 3 * zs,
            }}
          >
            {h.name}
          </text>
        );
      })()}
    </svg>
    </div>
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
          className="relative h-4 flex-1 cursor-pointer overflow-hidden rounded-full border border-border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  // History scrubber: dated bundles from factors/index.json; null date =
  // latest.
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    setDates([]);
    setSelectedDate(null);
    fetchFactorsIndex(sourceId).then(setDates);
  }, [sourceId]);

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
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {data.entities.length > 0 ? (
              <div
                className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 transition-opacity duration-150"
                style={{ opacity: isFetching ? 0.7 : 1 }}
              >
                <Scatter entities={data.entities} />
              </div>
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
