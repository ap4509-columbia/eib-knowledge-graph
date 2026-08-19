"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
// @ts-expect-error — cytoscape-d3-force ships without bundled types
import d3Force from "cytoscape-d3-force";
import { useTheme } from "next-themes";
import type { Snapshot } from "@/lib/api/types";
import { makeGraphStyles } from "./graphStyles";

// Register the d3-force extension once on the client.
if (typeof window !== "undefined") {
  try {
    cytoscape.use(d3Force);
  } catch {
    // Already registered (HMR re-imports). Safe to ignore.
  }
}

export interface GraphFilters {
  visibleTypes: Set<string>;
  /** Legacy field name — kept for compatibility. Now used for causal types. */
  visibleCategories: Set<string>;
  minDegree: number;
  /** Optional industry filter (STOXX): node id → inferred sector. */
  sectorOf?: Map<string, string> | null;
  /** Sectors currently checked; only consulted when sectorOf is present. */
  visibleSectors?: Set<string> | null;
}

/** Live-physics knobs. `enabled=false` (default) uses the precomputed
 * `preset` layout — the fixed "best view". Turning `enabled` on switches to
 * a d3-force simulation with the given repulsion / link-strength values. */
export interface PhysicsSettings {
  enabled: boolean;
  repulsion: number;       // absolute value; sign flipped internally (negative = repel)
  linkStrength: number;    // preferred edge length in px
}

export const DEFAULT_PHYSICS: PhysicsSettings = {
  enabled: false,
  repulsion: 90,
  linkStrength: 60,
};

export interface GraphCanvasProps {
  snapshot: Snapshot | null;
  filters: GraphFilters;
  focusedNodeId: string | null;
  onNodeClick?: (id: string) => void;
  physics?: PhysicsSettings;
}

interface EdgeTooltip {
  text: string;
  x: number;
  y: number;
}

export function GraphCanvas({
  snapshot,
  filters,
  focusedNodeId,
  onNodeClick,
  physics = DEFAULT_PHYSICS,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layoutRef = useRef<any>(null);
  // rAF handle for the deferred cy.fit() so we can cancel it if the effect
  // re-runs (or the component unmounts) before the frame fires — otherwise
  // switching tabs mid-frame crashes with Core.headless on a destroyed cy.
  const pendingFitRef = useRef<number | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const [tooltip, setTooltip] = useState<EdgeTooltip | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  // Zoom-compensation scale currently baked into the stylesheet (see
  // makeGraphStyles). Kept in refs so the fit callbacks — which run outside
  // the effects that know the current theme — can restyle correctly.
  const styleScaleRef = useRef(1);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const physicsEnabledRef = useRef(physics.enabled);
  physicsEnabledRef.current = physics.enabled;

  // Fit the viewport, then normalize node/label sizes to the zoom the fit
  // landed on. Sizes in the stylesheet are graph units, so a sprawling
  // layout (STOXX, spring_layout × 900) fits at low zoom and renders tiny
  // nodes while a compact one (FNSPID) renders huge ones. Restyling with
  // scale ≈ 1/zoom makes nodes come out at the same pixel size in both,
  // then a second fit accounts for the changed bounding box.
  const fitNormalized = (
    cy: Core,
    eles?: cytoscape.CollectionReturnValue
  ) => {
    const fit = () =>
      eles ? cy.fit(eles, 40) : cy.fit(undefined, 40);
    // Iterate: restyling changes node sizes, which changes the bounding box
    // the next fit sees, which changes the zoom the scale is derived from.
    // Sparse views (a few hub nodes) need 2–3 rounds to converge. Returns
    // whether the scale actually moved.
    const converge = (): boolean => {
      let changed = false;
      for (let i = 0; i < 4; i++) {
        const k = Math.min(8, Math.max(0.25, 1 / cy.zoom()));
        if (Math.abs(k - styleScaleRef.current) <= styleScaleRef.current * 0.1)
          break;
        styleScaleRef.current = k;
        changed = true;
        cy.style(
          makeGraphStyles(isDarkRef.current, k) as cytoscape.StylesheetJson
        ).update();
        fit();
      }
      return changed;
    };
    fit();
    converge();
    // With sizes known: organically relax multi-cluster views (node
    // repulsion + edge attraction), push apart nodes that still touch,
    // then re-frame. The relaxation can change the bounding box
    // substantially, so re-converge the size scale afterwards (and
    // re-separate if sizes grew). Preset layout only — the interactive
    // physics mode spaces itself.
    if (!physicsEnabledRef.current) {
      const relaxed = forceRelax(cy);
      const separated = separateOverlaps(cy);
      if (relaxed || separated) {
        fit();
        if (converge() && separateOverlaps(cy)) fit();
      }
    }
    assignLabelBudget(cy);
  };

  // News corpora (STOXX especially) are a swarm of small disconnected
  // clusters — one per story — whose per-month spring layouts all pile
  // into the same coordinate space, reading as one clotted blob. Relax
  // them with a deterministic Fruchterman–Reingold pass: every node
  // repels every other, edges pull their endpoints together, and a light
  // gravity keeps disconnected clusters from drifting apart. Connected
  // stories settle into tight organic clumps that stand clear of each
  // other. Single-component views (FNSPID's curated hairball) are left
  // untouched, as are very large views (cost is O(N² · iterations)).
  const forceRelax = (cy: Core): boolean => {
    const visible = cy.elements(":visible");
    const nodeColl = visible.nodes();
    const n = nodeColl.length;
    if (n < 2 || n > 500) return false;
    if (visible.components().length < 2) return false;

    const scale = styleScaleRef.current;
    const pts = nodeColl.map((nd) => ({
      nd,
      x: nd.position("x"),
      y: nd.position("y"),
      r: nd.width() / 2,
      dx: 0,
      dy: 0,
    }));
    const idxOf = new Map(pts.map((p, i) => [p.nd.id(), i]));
    const springs: Array<[number, number]> = [];
    visible.edges().forEach((e) => {
      const a = idxOf.get(e.data("source"));
      const b = idxOf.get(e.data("target"));
      if (a !== undefined && b !== undefined && a !== b) springs.push([a, b]);
    });

    // Ideal pairwise distance. Kept modest — with a large kIdeal the cloud
    // area outgrows what the zoom-compensation clamp can recover and nodes
    // shrink to dots.
    const kIdeal = 50 * scale;
    // Repulsion is LOCAL (cutoff): it resolves crowding without inflating
    // the whole layout; global shape comes from the springs plus gravity.
    const repCutoff = 3 * kIdeal;
    // Start from the centroid so gravity doesn't yank the cloud sideways.
    const cx0 = pts.reduce((s, p) => s + p.x, 0) / n;
    const cy0 = pts.reduce((s, p) => s + p.y, 0) / n;

    const ITER = 150;
    let temp = kIdeal * 2.5; // max displacement per tick, cools linearly
    const cool = temp / (ITER + 1);
    const gravity = 0.08;

    for (let iter = 0; iter < ITER; iter++) {
      for (const p of pts) {
        p.dx = 0;
        p.dy = 0;
      }
      // Repulsion — nearby pairs only
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pts[i];
          const b = pts[j];
          let vx = a.x - b.x;
          let vy = a.y - b.y;
          let d = Math.hypot(vx, vy);
          if (d > repCutoff) continue;
          if (d < 1e-4) {
            // Coincident: deterministic direction so renders stay stable.
            const ang = ((i * 37 + j * 101) % 360) * (Math.PI / 180);
            vx = Math.cos(ang);
            vy = Math.sin(ang);
            d = 1;
          }
          const rep = (kIdeal * kIdeal) / d;
          const ux = (vx / d) * rep;
          const uy = (vy / d) * rep;
          a.dx += ux;
          a.dy += uy;
          b.dx -= ux;
          b.dy -= uy;
        }
      }
      // Attraction — springs along edges
      for (const [i, j] of springs) {
        const a = pts[i];
        const b = pts[j];
        const vx = a.x - b.x;
        const vy = a.y - b.y;
        const d = Math.max(1e-4, Math.hypot(vx, vy));
        const attr = (d * d) / kIdeal;
        const ux = (vx / d) * attr;
        const uy = (vy / d) * attr;
        a.dx -= ux;
        a.dy -= uy;
        b.dx += ux;
        b.dy += uy;
      }
      // Gravity toward the centroid keeps disconnected clusters in frame
      for (const p of pts) {
        p.dx += (cx0 - p.x) * gravity;
        p.dy += (cy0 - p.y) * gravity;
      }
      // Apply, capped by the cooling temperature
      for (const p of pts) {
        const len = Math.hypot(p.dx, p.dy);
        if (len > 1e-6) {
          const step = Math.min(len, temp);
          p.x += (p.dx / len) * step;
          p.y += (p.dy / len) * step;
        }
      }
      temp -= cool;
    }

    cy.batch(() => {
      for (const p of pts) p.nd.position({ x: p.x, y: p.y });
    });
    return true;
  };

  // Permanent labels: everything gets one in comfortable views; in dense
  // views the most-connected ~40% keep theirs (rest label on hover), and
  // every disconnected cluster's top entity is always named so no island
  // goes unidentified. Runs after every fit so filter/range changes
  // re-rank.
  const assignLabelBudget = (cy: Core) => {
    const visible = cy.elements(":visible");
    const nodes = visible
      .nodes()
      .toArray()
      .sort((a, b) => (b.data("degree") ?? 0) - (a.data("degree") ?? 0));
    const n = nodes.length;
    const comps = visible.components();
    // Label everything when the view has room: moderate node counts, or a
    // many-component layout (the packer gives each cluster its own region,
    // so labels don't pile up the way they do in one dense hairball).
    const labelAll = n <= 220 || comps.length >= 8;
    const budget = labelAll ? n : Math.max(80, Math.round(n * 0.4));
    const chosen = new Set(nodes.slice(0, budget).map((nd) => nd.id()));
    for (const comp of comps) {
      const top = comp
        .nodes()
        .toArray()
        .sort((a, b) => (b.data("degree") ?? 0) - (a.data("degree") ?? 0))[0];
      if (top) chosen.add(top.id());
    }
    cy.batch(() => {
      nodes.forEach((nd) =>
        nd.data("showLabel", chosen.has(nd.id()) ? 1 : 0)
      );
    });
  };

  // Nudge overlapping visible nodes apart. Not a physics simulation — a few
  // damped pairwise relaxation passes that resolve touching/overlapping
  // circles while leaving the overall layout shape intact. Node radii come
  // from the *styled* width (which includes the zoom-compensation scale),
  // so this must run after fitNormalized has converged. Returns whether
  // anything moved.
  const separateOverlaps = (cy: Core): boolean => {
    const nodes = cy.nodes(":visible");
    // O(N²) per pass — fine at the few-hundred-node scale the filters
    // produce; bail on pathological views rather than jank the UI.
    if (nodes.length < 2 || nodes.length > 900) return false;
    const pts = nodes.map((n) => ({
      n,
      x: n.position("x"),
      y: n.position("y"),
      r: n.width() / 2,
    }));
    const pad = 9 * styleScaleRef.current; // breathing room, in graph units
    let movedAny = false;
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = a.r + b.r + pad;
          if (d >= min) continue;
          if (d < 1e-6) {
            // Coincident centres: pick a deterministic direction so
            // repeated renders stay stable.
            const ang = ((i * 37 + j * 101) % 360) * (Math.PI / 180);
            dx = Math.cos(ang);
            dy = Math.sin(ang);
            d = 1;
          }
          // Split the overlap between the pair, half-damped so dense
          // clusters relax over passes instead of ricocheting.
          const push = ((min - d) / d) * 0.5;
          a.x -= dx * push * 0.5;
          a.y -= dy * push * 0.5;
          b.x += dx * push * 0.5;
          b.y += dy * push * 0.5;
          moved = movedAny = true;
        }
      }
      if (!moved) break;
    }
    if (movedAny) {
      cy.batch(() => {
        for (const p of pts) p.n.position({ x: p.x, y: p.y });
      });
    }
    return movedAny;
  };

  // Mount Cytoscape once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cy = cytoscape({
      container,
      elements: [],
      style: makeGraphStyles(isDark) as cytoscape.StylesheetJson,
      layout: { name: "preset" },
      wheelSensitivity: 0.2,
      minZoom: 0.05,
      maxZoom: 4,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => {
      onNodeClickRef.current?.(evt.target.id());
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) onNodeClickRef.current?.("");
    });

    cy.on("mouseover", "edge", (evt) => {
      const e = evt.target;
      const orig = evt.originalEvent as MouseEvent | undefined;
      const weight = e.data("weight");
      e.addClass("hovered");
      setTooltip({
        text: `${e.data("source")}  →  ${e.data("rel")}  →  ${e.data("target")}${weight > 1 ? `   ·   ×${weight}` : ""}`,
        x: orig?.clientX ?? 0,
        y: orig?.clientY ?? 0,
      });
    });
    cy.on("mousemove", "edge", (evt) => {
      const orig = evt.originalEvent as MouseEvent | undefined;
      if (!orig) return;
      setTooltip((prev) =>
        prev ? { ...prev, x: orig.clientX, y: orig.clientY } : prev
      );
    });
    cy.on("mouseout", "edge", (evt) => {
      evt.target.removeClass("hovered");
      setTooltip(null);
    });

    // Small nodes hide their label by default (see graphStyles label
    // thinning) — hovering reveals it.
    cy.on("mouseover", "node", (evt) => {
      evt.target.addClass("hovered");
    });
    cy.on("mouseout", "node", (evt) => {
      evt.target.removeClass("hovered");
    });

    // No physics: dragging a node moves only that node. Neighbors stay still.
    // Positions come precomputed from the backend and are loaded verbatim.

    const resizeObs = new ResizeObserver(() => cy.resize());
    resizeObs.observe(container);

    return () => {
      if (pendingFitRef.current !== null) {
        cancelAnimationFrame(pendingFitRef.current);
        pendingFitRef.current = null;
      }
      resizeObs.disconnect();
      try {
        layoutRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Replace elements + start a fresh d3-force simulation on snapshot change.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !snapshot) return;

    // Stop any running layout before mutating elements
    try {
      layoutRef.current?.stop?.();
    } catch {
      /* ignore */
    }

    // Nodes carry their precomputed layout positions from the snapshot JSON
    // (spring_layout, deterministic per snapshot). Pass them as `position`
    // and use Cytoscape's `preset` layout so the graph appears at its final
    // arrangement instantly — no settling animation, no drift.
    // If a snapshot predates the position field, fall back to a small grid
    // so we still render something rather than crashing.
    const hasPositions = snapshot.nodes.some(
      (n) => typeof n.x === "number" && typeof n.y === "number"
    );

    // Normalise precomputed positions to a spread proportional to the node
    // count. Different pipelines write coordinates at wildly different
    // scales (FNSPID runner ~[-1,1] cube; the factor pipeline pre-scales by
    // 900), and a fixed multiplier either packs one corpus or scatters the
    // other. Rescaling the bounding box to sqrt(N)-proportional target
    // keeps node density visually consistent regardless of source.
    const posNodes = snapshot.nodes.filter(
      (n) => typeof n.x === "number" && typeof n.y === "number"
    );
    let sx = 1, sy = 1, cx = 0, cy0 = 0;
    if (posNodes.length > 1) {
      const xs = posNodes.map((n) => n.x as number);
      const ys = posNodes.map((n) => n.y as number);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      cx = (minX + maxX) / 2;
      cy0 = (minY + maxY) / 2;
      const spreadX = Math.max(1e-6, maxX - minX);
      const spreadY = Math.max(1e-6, maxY - minY);
      // Target diagonal: ~55px of room per node along each axis, clamped.
      const target = Math.min(2600, Math.max(500, Math.sqrt(posNodes.length) * 110));
      sx = target / spreadX;
      sy = target / spreadY;
    }

    // Node size maps `sizeDeg` (see graphStyles), a 0–50 value normalised to
    // this snapshot's own degree ceiling. Raw degree spans hundreds in
    // FNSPID but only ~1–8 in the STOXX corpus, so mapping raw degree to a
    // fixed 1–50 domain leaves every STOXX node at the minimum size. The
    // sqrt keeps mid-degree nodes visually distinct instead of ceding the
    // whole range to the single biggest hub.
    const maxDeg = Math.max(1, ...snapshot.nodes.map((n) => n.degree || 0));
    const sizeDeg = (deg: number) =>
      Math.sqrt(Math.max(0, deg) / maxDeg) * 50;

    const elements: ElementDefinition[] = [];
    for (const n of snapshot.nodes) {
      const el: ElementDefinition = {
        group: "nodes",
        data: {
          id: n.id,
          label: n.id,
          type: n.type,
          degree: n.degree,
          sizeDeg: sizeDeg(n.degree),
        },
      };
      if (typeof n.x === "number" && typeof n.y === "number") {
        el.position = { x: (n.x - cx) * sx, y: (n.y - cy0) * sy };
      }
      elements.push(el);
    }
    for (const e of snapshot.edges) {
      elements.push({
        group: "edges",
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          rel: e.rel,
          rel_cat: e.rel_cat,
          polarity: e.polarity,
          causal_type: e.causal_type ?? "OTHER",
          origin: e.origin ?? "news",
          score: e.score ?? undefined,
          weight: e.weight,
        },
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    // Layout selection:
    // - physics disabled → `preset` uses each node's precomputed x/y verbatim
    // - physics enabled  → d3-force with user's repulsion/link-strength
    // - no positions available → `grid` fallback (should be rare)
    let layout;
    if (physics.enabled) {
      layout = cy.layout({
        name: "d3-force",
        animate: true,
        fit: false,
        randomize: !hasPositions, // seed from preset positions if we have them
        fixedAfterDragging: false,
        linkId: (d: { id: string }) => d.id,
        linkDistance: physics.linkStrength,
        manyBodyStrength: -physics.repulsion,
        collideRadius: 18,
        alpha: 0.4,
        alphaDecay: 0.03,
        alphaMin: 0.001,
        velocityDecay: 0.5,
        infinite: false,
      } as cytoscape.LayoutOptions);
    } else if (hasPositions) {
      layout = cy.layout({
        name: "preset",
        fit: false,
        animate: false,
      } as cytoscape.LayoutOptions);
    } else {
      layout = cy.layout({
        name: "grid",
        fit: false,
        animate: false,
      } as cytoscape.LayoutOptions);
    }
    layoutRef.current = layout;
    layout.run();

    // Fit the viewport once so everything is visible, then hand control to
    // the user. No continuous refit — positions are stable.
    // Cancel any prior pending fit before scheduling a new one; guard the
    // callback against cy having been destroyed between the schedule and the
    // frame firing (happens on rapid tab switches).
    if (pendingFitRef.current !== null) {
      cancelAnimationFrame(pendingFitRef.current);
    }
    pendingFitRef.current = requestAnimationFrame(() => {
      pendingFitRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) return;
      cy.resize();
      fitNormalized(cy);
    });
  }, [snapshot, physics.enabled, physics.repulsion, physics.linkStrength]);

  // Swap the Cytoscape stylesheet when the theme changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(
      makeGraphStyles(isDark, styleScaleRef.current) as cytoscape.StylesheetJson
    ).update();
  }, [isDark]);

  // Apply filters (no relayout)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const { visibleTypes, visibleCategories, minDegree, sectorOf, visibleSectors } =
      filters;

    cy.batch(() => {
      const nodeVisible = new Map<string, boolean>();
      cy.nodes().forEach((n) => {
        const t = n.data("type");
        const d = n.data("degree") ?? 0;
        const sectorOk =
          !sectorOf || !visibleSectors
            ? true
            : visibleSectors.has(sectorOf.get(n.id()) ?? "Other");
        const visible = visibleTypes.has(t) && d >= minDegree && sectorOk;
        nodeVisible.set(n.id(), visible);
        n.style("display", visible ? "element" : "none");
      });
      cy.edges().forEach((e) => {
        // Edge visibility now keys on causal_type (the primary coloring
        // signal), not on rel_cat. The Set is still named visibleCategories
        // for backward compat.
        const cat = e.data("causal_type") ?? "OTHER";
        const srcOk = nodeVisible.get(e.data("source")) ?? false;
        const tgtOk = nodeVisible.get(e.data("target")) ?? false;
        const visible = visibleCategories.has(cat) && srcOk && tgtOk;
        e.style("display", visible ? "element" : "none");
      });
    });

    // Re-fit the viewport to whatever's currently visible. Without this,
    // filter changes could leave the graph off-centre (e.g. hiding all
    // Concept nodes leaves the remaining core drifting in the corner).
    // Same rAF-cancel dance as the snapshot effect below to avoid firing
    // fit() on a destroyed cy after a tab switch.
    if (pendingFitRef.current !== null) {
      cancelAnimationFrame(pendingFitRef.current);
    }
    pendingFitRef.current = requestAnimationFrame(() => {
      pendingFitRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) return;
      const visible = cy.elements(':visible');
      if (visible.length > 0) fitNormalized(cy, visible);
    });
  }, [filters]);

  // Focus a node: highlight + animate viewport
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass("dimmed highlighted focused");
    });
    cy.elements().unselect();

    if (!focusedNodeId) return;
    const node = cy.getElementById(focusedNodeId);
    if (node.empty()) return;

    const neighborhood = node.closedNeighborhood();
    const others = cy.elements().difference(neighborhood);

    cy.batch(() => {
      others.addClass("dimmed");
      neighborhood.addClass("highlighted");
      node.addClass("focused");
    });

    cy.animate({
      fit: { eles: neighborhood, padding: 80 },
      duration: 400,
      easing: "ease-in-out",
    });
  }, [focusedNodeId]);

  return (
    <>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
        className="bg-background"
      />
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover/95 px-2.5 py-1.5 font-mono text-xs text-popover-foreground shadow-lg backdrop-blur"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y + 14,
            maxWidth: 360,
          }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}
