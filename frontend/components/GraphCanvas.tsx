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
  visibleCategories: Set<string>;
  minDegree: number;
}

export interface GraphCanvasProps {
  snapshot: Snapshot | null;
  filters: GraphFilters;
  focusedNodeId: string | null;
  onNodeClick?: (id: string) => void;
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
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layoutRef = useRef<any>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const [tooltip, setTooltip] = useState<EdgeTooltip | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

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

    // When the user grabs a node, reheat the simulation so neighbors respond.
    cy.on("grab", "node", () => {
      const layout = layoutRef.current;
      if (layout && typeof layout.reheat === "function") {
        layout.reheat();
      }
    });

    const resizeObs = new ResizeObserver(() => cy.resize());
    resizeObs.observe(container);

    return () => {
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

    const elements: ElementDefinition[] = [];
    for (const n of snapshot.nodes) {
      elements.push({
        group: "nodes",
        data: { id: n.id, label: n.id, type: n.type, degree: n.degree },
      });
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
          score: e.score ?? undefined,
          weight: e.weight,
        },
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    // Start a d3-force simulation. Tuned for subtle, calm motion — lower
    // starting energy + faster decay + heavy friction so nodes settle
    // quickly and only twitch a little when neighbors are dragged.
    const layout = cy.layout({
      name: "d3-force",
      animate: true,
      fit: false,
      randomize: true,
      fixedAfterDragging: false,
      // forces — gentler
      linkId: (d: { id: string }) => d.id,
      linkDistance: 60,
      manyBodyStrength: -90,
      collideRadius: 18,
      // simulation — settle fast, dampen wobble
      alpha: 0.6,
      alphaDecay: 0.04,
      alphaMin: 0.001,
      velocityDecay: 0.7,
      infinite: false,
    } as cytoscape.LayoutOptions);
    layoutRef.current = layout;

    layout.run();

    // Keep the graph centered while the d3-force simulation settles.
    // The forces spread nodes outward over ~3s; a single fit() right after
    // layoutready catches them mid-flight and they drift off-screen as the
    // simulation expands. So we re-fit on a short interval until the user
    // touches the canvas.
    const fit = () => {
      cy.resize();
      cy.fit(undefined, 40);
      cy.center();
    };
    requestAnimationFrame(fit);

    const refitInterval = window.setInterval(fit, 200);
    const stopRefitTimer = window.setTimeout(
      () => window.clearInterval(refitInterval),
      2200
    );

    // Stop auto-fitting as soon as the user touches the canvas.
    const onUserInteract = () => {
      window.clearInterval(refitInterval);
      window.clearTimeout(stopRefitTimer);
    };
    const containerEl = containerRef.current;
    containerEl?.addEventListener("mousedown", onUserInteract);
    containerEl?.addEventListener("wheel", onUserInteract, { passive: true });
    containerEl?.addEventListener("touchstart", onUserInteract, {
      passive: true,
    });

    return () => {
      window.clearInterval(refitInterval);
      window.clearTimeout(stopRefitTimer);
      containerEl?.removeEventListener("mousedown", onUserInteract);
      containerEl?.removeEventListener("wheel", onUserInteract);
      containerEl?.removeEventListener("touchstart", onUserInteract);
    };
  }, [snapshot]);

  // Swap the Cytoscape stylesheet when the theme changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(makeGraphStyles(isDark) as cytoscape.StylesheetJson).update();
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
        const cat = e.data("rel_cat");
        const srcOk = nodeVisible.get(e.data("source")) ?? false;
        const tgtOk = nodeVisible.get(e.data("target")) ?? false;
        const visible = visibleCategories.has(cat) && srcOk && tgtOk;
        e.style("display", visible ? "element" : "none");
      });
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
