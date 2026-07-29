// Union several monthly snapshots into one graph.
//
// The timeline lets an analyst pick a date range ("Q1 2020 through Q2 2021"),
// which means N monthly snapshot files have to become a single graph. The
// merge mirrors the aggregation the backend already does within a month
// (see build_snapshots in backend/runner.py) so a merged range is
// indistinguishable in shape from a snapshot the runner produced:
//
//   - edges are keyed on (source, target, rel, rel_cat) and their weights sum
//   - node degree is the weighted in+out sum over the merged edge set
//   - stats are recomputed from the merged result
//
// Edge ids are NOT reusable: the runner mints them per snapshot as "e0", "e1",
// … so the same id means different things in different months. Merged edges
// get fresh "m<i>" ids assigned over a sorted key list, which keeps them
// stable for a given range (Cytoscape keys elements by id).

import type { EdgeJson, NodeJson, Snapshot } from "./api/types";

// Components with no path to the anchor month go in a halo around it. The
// anchor layout occupies roughly [-500, 500], so the halo starts outside that
// and is wide enough to spread hundreds of small clusters without overlap.
const HALO_INNER_RADIUS = 640;
const HALO_OUTER_RADIUS = 1600;
/** Golden angle — successive slots never line up, so the halo fills evenly. */
const GOLDEN_ANGLE = 2.399963;
/** Relaxation passes for pulling unpositioned nodes toward their neighbors. */
const PLACEMENT_PASSES = 6;

function edgeKey(e: EdgeJson): string {
  // Matches the backend's edge_counter key. NUL separates the parts because
  // entity names and relation labels routinely contain spaces.
  return [e.source, e.target, e.rel, e.rel_cat].join("\u0000");
}

/** FNV-1a. Only used to derive stable per-node jitter, not for security. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic offset so nodes sharing a centroid don't stack exactly. */
function jitterFor(id: string): [number, number] {
  const h = hashString(id);
  const angle = ((h % 3600) / 3600) * Math.PI * 2;
  const radius = 18 + ((h >>> 12) % 60);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pick the snapshot whose precomputed layout seeds the merged view.
 *
 * Each month's positions come from its own `spring_layout` run, so they're
 * only internally consistent — rotation and reflection are arbitrary between
 * months and averaging them produces mush. We therefore adopt exactly one
 * month's layout wholesale (the one covering the most nodes) and place
 * everything else relative to it.
 */
function pickAnchor(snapshots: Snapshot[]): Snapshot | null {
  let best: Snapshot | null = null;
  let bestCount = 0;
  for (const snap of snapshots) {
    const count = snap.nodes.filter(
      (n) => typeof n.x === "number" && typeof n.y === "number"
    ).length;
    // >= so ties resolve to the later month — more recent structure wins.
    if (count > 0 && count >= bestCount) {
      best = snap;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Lay out the merged node set.
 *
 * Nodes present in the anchor month keep its exact coordinates. Everything
 * else is pulled to the centroid of its already-placed neighbors over a few
 * passes, with a deterministic jitter so co-located nodes stay distinguishable.
 * Nodes that never touch a placed neighbor land on a ring outside the canvas.
 *
 * This is a heuristic — it preserves the anchor month's readable structure and
 * renders instantly (no settling animation), but it does not re-solve the
 * layout for the merged edge set. The physics toggle in graph settings is the
 * escape hatch when an analyst wants the merged graph properly re-settled.
 */
function layoutMerged(
  nodeIds: string[],
  edges: EdgeJson[],
  anchor: Snapshot | null
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  if (anchor) {
    for (const n of anchor.nodes) {
      if (typeof n.x === "number" && typeof n.y === "number") {
        pos.set(n.id, { x: n.x, y: n.y });
      }
    }
  }
  if (pos.size === 0) return pos;

  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  for (let pass = 0; pass < PLACEMENT_PASSES; pass++) {
    // Collect then apply, so placements within a pass can't chain off each
    // other — the result stays independent of iteration order.
    const placed: [string, { x: number; y: number }][] = [];
    for (const id of nodeIds) {
      if (pos.has(id)) continue;
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const neighbor of adjacency.get(id) ?? []) {
        const p = pos.get(neighbor);
        if (p) {
          sx += p.x;
          sy += p.y;
          count++;
        }
      }
      if (count === 0) continue;
      const [jx, jy] = jitterFor(id);
      placed.push([
        id,
        { x: round2(sx / count + jx), y: round2(sy / count + jy) },
      ]);
    }
    if (placed.length === 0) break;
    for (const [id, p] of placed) pos.set(id, p);
  }

  // Whatever is left belongs to components with no path to the anchor month —
  // typically entity clusters that appear only in months the anchor doesn't
  // cover. Placing them individually around one circle would shred that
  // structure, so each component gets its own slot on an outer ring and is
  // laid out as a small disc there.
  placeDetachedComponents(
    nodeIds.filter((id) => !pos.has(id)),
    adjacency,
    pos
  );

  return pos;
}

/**
 * Group the still-unplaced nodes into connected components and give each one a
 * slot on the outer ring, sized so bigger components get more arc.
 */
function placeDetachedComponents(
  unplaced: string[],
  adjacency: Map<string, string[]>,
  pos: Map<string, { x: number; y: number }>
): void {
  if (unplaced.length === 0) return;

  const remaining = new Set(unplaced);
  const components: string[][] = [];
  for (const start of unplaced) {
    if (!remaining.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    remaining.delete(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (remaining.has(neighbor)) {
          remaining.delete(neighbor);
          stack.push(neighbor);
        }
      }
    }
    // Sorted so a component's internal layout doesn't depend on traversal order.
    component.sort();
    components.push(component);
  }

  // Largest first, ties broken by the first id — deterministic ordering, and
  // it puts the biggest clusters nearest the main graph.
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  const n = components.length;
  const innerSq = HALO_INNER_RADIUS ** 2;
  const outerSq = HALO_OUTER_RADIUS ** 2;

  components.forEach((component, i) => {
    // Sunflower placement over the annulus: the sqrt keeps density uniform by
    // area rather than piling everything onto the inner edge.
    const t = n > 1 ? i / (n - 1) : 0;
    const centerR = Math.sqrt(innerSq + (outerSq - innerSq) * t);
    const centerA = i * GOLDEN_ANGLE;
    const cx = Math.cos(centerA) * centerR;
    const cy = Math.sin(centerA) * centerR;

    if (component.length === 1) {
      pos.set(component[0], { x: round2(cx), y: round2(cy) });
      return;
    }

    // Same sunflower trick within the cluster, so members spread out evenly.
    const spacing = 26;
    component.forEach((id, j) => {
      const r = spacing * Math.sqrt(j);
      const theta = j * GOLDEN_ANGLE;
      pos.set(id, {
        x: round2(cx + r * Math.cos(theta)),
        y: round2(cy + r * Math.sin(theta)),
      });
    });
  });
}

/**
 * Merge monthly snapshots into one. `snapshots` must be in chronological
 * order. A single snapshot is returned untouched, so the common
 * one-month-selected case keeps the runner's output verbatim.
 */
export function mergeSnapshots(snapshots: Snapshot[]): Snapshot | null {
  if (snapshots.length === 0) return null;
  if (snapshots.length === 1) return snapshots[0];

  const months = snapshots.map((s) => s.month);

  // ── Edges: sum weights, keep the strongest score, prefer observed origin ──
  type EdgeAcc = Omit<EdgeJson, "id">;
  const edgeAcc = new Map<string, EdgeAcc>();
  for (const snap of snapshots) {
    for (const e of snap.edges) {
      const key = edgeKey(e);
      const prev = edgeAcc.get(key);
      if (!prev) {
        edgeAcc.set(key, {
          source: e.source,
          target: e.target,
          rel: e.rel,
          rel_cat: e.rel_cat,
          polarity: e.polarity,
          causal_type: e.causal_type ?? "OTHER",
          origin: e.origin ?? "news",
          weight: e.weight,
          score: e.score,
        });
        continue;
      }
      prev.weight += e.weight;
      if (e.score != null) {
        prev.score = prev.score == null ? e.score : Math.max(prev.score, e.score);
      }
      // An edge observed in the news anywhere in the range is news, even if a
      // model also predicted it in another month — solid beats dashed.
      if ((e.origin ?? "news") === "news") prev.origin = "news";
    }
  }

  const edges: EdgeJson[] = [...edgeAcc.keys()]
    .sort()
    .map((key, i) => ({ id: `m${i}`, ...edgeAcc.get(key)! }));

  // ── Nodes: union by id, first non-UNK type wins ──────────────────────────
  const nodeTypes = new Map<string, string>();
  for (const snap of snapshots) {
    for (const n of snap.nodes) {
      const prev = nodeTypes.get(n.id);
      if (prev === undefined || (prev === "UNK" && n.type !== "UNK")) {
        nodeTypes.set(n.id, n.type);
      }
    }
  }

  // Degree must be recomputed rather than summed across months: it's the
  // weighted in+out sum, and summing per-month degrees would double-count
  // every relationship that recurs.
  const degrees = new Map<string, number>();
  for (const e of edges) {
    degrees.set(e.source, (degrees.get(e.source) ?? 0) + e.weight);
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + e.weight);
  }

  const nodeIds = [...nodeTypes.keys()].sort();
  const anchor = pickAnchor(snapshots);
  const positions = layoutMerged(nodeIds, edges, anchor);

  const nodes: NodeJson[] = nodeIds.map((id) => {
    const p = positions.get(id);
    return {
      id,
      type: nodeTypes.get(id)!,
      degree: degrees.get(id) ?? 0,
      ...(p ? { x: p.x, y: p.y } : {}),
    };
  });

  return {
    month: `${months[0]}..${months[months.length - 1]}`,
    range: {
      from: months[0],
      to: months[months.length - 1],
      months,
      anchor: anchor?.month ?? null,
    },
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      scored_edges: edges.filter((e) => e.score != null).length,
    },
    nodes,
    edges,
  };
}
