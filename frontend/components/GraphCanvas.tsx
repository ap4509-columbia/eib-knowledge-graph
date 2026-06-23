"use client";

import { useEffect, useRef } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import type { Snapshot } from "@/lib/api/types";
import { graphStyles } from "./graphStyles";

export interface GraphCanvasProps {
  snapshot: Snapshot | null;
}

export function GraphCanvas({ snapshot }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

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

    // Cytoscape reads dimensions on mount; if the parent was 0px at that moment,
    // ask it to re-measure once the layout has settled.
    const resizeObs = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 32);
    });
    resizeObs.observe(container);

    return () => {
      resizeObs.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Update elements when snapshot changes
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

    // small delay so layout positions settle before we fit
    requestAnimationFrame(() => {
      cy.resize();
      cy.fit(undefined, 32);
    });
  }, [snapshot]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
      className="bg-zinc-950"
    />
  );
}
