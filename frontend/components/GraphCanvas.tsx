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
    fit();
    // Iterate: restyling changes node sizes, which changes the bounding box
    // the next fit sees, which changes the zoom the scale is derived from.
    // Sparse views (a few hub nodes) need 2–3 rounds to converge.
    for (let i = 0; i < 4; i++) {
      const k = Math.min(8, Math.max(0.25, 1 / cy.zoom()));
      if (Math.abs(k - styleScaleRef.current) <= styleScaleRef.current * 0.1)
        break;
      styleScaleRef.current = k;
      cy.style(
        makeGraphStyles(isDarkRef.current, k) as cytoscape.StylesheetJson
      ).update();
      fit();
    }
    // With final sizes known, gently push apart any visible nodes that
    // touch, then re-frame once. Runs only on the preset layout — the
    // physics simulation handles its own spacing.
    if (!physicsEnabledRef.current && separateOverlaps(cy)) fit();
    assignLabelBudget(cy);
  };

  // Permanent labels go to the most-connected nodes of the current view
  // only; everything else stays unlabeled until hovered/focused. Runs
  // after every fit so filter/range changes re-rank.
  const LABEL_BUDGET = 40;
  const assignLabelBudget = (cy: Core) => {
    const visible = cy
      .nodes(":visible")
      .toArray()
      .sort((a, b) => (b.data("degree") ?? 0) - (a.data("degree") ?? 0));
    cy.batch(() => {
      visible.forEach((n, i) => n.data("showLabel", i < LABEL_BUDGET ? 1 : 0));
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
    const { visibleTypes, visibleCategories, minDegree } = filters;

    cy.batch(() => {
      const nodeVisible = new Map<string, boolean>();
      cy.nodes().forEach((n) => {
        const t = n.data("type");
        const d = n.data("degree") ?? 0;
        const visible = visibleTypes.has(t) && d >= minDegree;
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
