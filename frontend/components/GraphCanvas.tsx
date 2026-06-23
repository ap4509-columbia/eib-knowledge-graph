"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import type { Snapshot } from "@/lib/api/types";
import { graphStyles } from "./graphStyles";

interface EdgeTooltip {
  text: string;
  x: number;
  y: number;
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

export function GraphCanvas({
  snapshot,
  filters,
  focusedNodeId,
  onNodeClick,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const [tooltip, setTooltip] = useState<EdgeTooltip | null>(null);

  // Mount Cytoscape once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cy = cytoscape({
      container,
      elements: [],
      style: graphStyles as cytoscape.StylesheetJson,
      layout: { name: "preset" },
      wheelSensitivity: 0.2,
      minZoom: 0.05,
      maxZoom: 4,
    });
    cyRef.current = cy;

    // Node click → callback (background click clears focus via parent)
    cy.on("tap", "node", (evt) => {
      onNodeClickRef.current?.(evt.target.id());
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) onNodeClickRef.current?.("");
    });

    // Edge hover tooltip
    cy.on("mouseover", "edge", (evt) => {
      const e = evt.target;
      const orig = evt.originalEvent as MouseEvent | undefined;
      const src = e.data("source");
      const tgt = e.data("target");
      const rel = e.data("rel");
      const weight = e.data("weight");
      e.addClass("hovered");
      setTooltip({
        text: `${src}  →  ${rel}  →  ${tgt}${weight > 1 ? `   ·   ×${weight}` : ""}`,
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

    const resizeObs = new ResizeObserver(() => {
      cy.resize();
    });
    resizeObs.observe(container);

    return () => {
      resizeObs.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Replace elements + re-layout when the snapshot changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !snapshot) return;

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
          score: e.score ?? undefined,
          weight: e.weight,
        },
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    cy.layout({
      name: "cose",
      animate: false,
      randomize: true,
      idealEdgeLength: 80,
      nodeRepulsion: () => 8000,
      gravity: 0.25,
      numIter: 400,
    } as cytoscape.LayoutOptions).run();

    requestAnimationFrame(() => {
      cy.resize();
      cy.fit(undefined, 32);
    });
  }, [snapshot]);

  // Apply filters (no re-layout) when filters change
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

  // Focus a node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusedNodeId) {
      cy?.elements().unselect();
      return;
    }
    const node = cy.getElementById(focusedNodeId);
    if (node.empty()) return;

    cy.elements().unselect();
    node.select();
    cy.animate({
      fit: { eles: node.closedNeighborhood(), padding: 80 },
      duration: 400,
      easing: "ease-in-out",
    });
  }, [focusedNodeId]);

  return (
    <>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
        className="bg-zinc-950"
      />
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-xs text-zinc-100 font-mono shadow-lg backdrop-blur"
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
