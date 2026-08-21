"""Retroactive cleanup of a corpus's month snapshots.

The STOXX corpus accumulated weeks of first-pass extraction before the
judge/refine/canonicalization stages existed (added 2026-08-20), and
snapshots are immutable merges — so junk entities and name variants from
that era persist in the graph and leak into everything downstream
(factors, GAT, predictions). This script cleans the stored snapshots in
place:

  1. Junk-entity removal — bare numbers/amounts, quarter boilerplate,
     generic finance phrases that make no sense as graph nodes
  2. Canonical merging — same TF-IDF + union-find machinery as
     canonicalize_corpus (same-type only, shared-word anchor, numeric
     guard); edges rewrite onto canonical names, weights sum
  3. Degree recompute + node prune (nodes with no surviving edges drop)

Run downstream refreshers afterwards (factors --factors-only, GAT,
predictions).

    python3 -m scripts.clean_snapshots \
        --corpus frontend/public/data/sources/stoxx_600_factors
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from scripts.canonicalize_corpus import build_entity_canonical_map

JUNK_PATTERNS = [
    re.compile(r"^\d+([.,]\d+)?$"),
    re.compile(r"^\d+([.,]\d+)?\s*(k|m|b|bn|billion|million|trillion)?\s*(usd|eur|gbp|dkk|chf|sek|dollars?|euros?)?$", re.I),
    re.compile(r"^Q[1-4]\b", re.I),
    re.compile(r"^(First|Second|Third|Fourth|Next)\s?Quarter\b", re.I),
    re.compile(r"^(H[12]|FY\d{2,4})\b", re.I),
    re.compile(r"^\d+(\.\d+)?%"),
    re.compile(r"^\d{4}$"),
]

GENERIC_BLOCKLIST = {
    "profit", "outlook", "revenue", "revenue growth", "earnings", "eps",
    "guidance", "potential upside", "share price", "stock price",
    "a share price crash", "share buybacks", "buyback", "dividend",
    "h1 results", "q2 results", "results", "sales", "growth",
    "pipeline growth", "market", "shares", "stock", "investors",
    "valuation", "upside", "downside", "trading", "performance",
}


def is_junk(name: str) -> bool:
    n = name.strip()
    if len(n) < 2:
        return True
    if n.lower() in GENERIC_BLOCKLIST:
        return True
    return any(p.match(n) for p in JUNK_PATTERNS)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--sim", type=float, default=0.9)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    snap_paths = sorted((args.corpus / "snapshots").glob("*.json"))
    snaps = {p: json.loads(p.read_text()) for p in snap_paths}

    # Corpus-wide entity stats for the canonical map
    freq: Counter = Counter()
    types: dict[str, Counter] = defaultdict(Counter)
    for snap in snaps.values():
        for n in snap.get("nodes", []):
            freq[n["id"]] += max(1, int(n.get("degree") or 1))
            types[n["id"]][n.get("type", "UNK")] += 1
    type_of = {e: c.most_common(1)[0][0] for e, c in types.items()}

    junk = {e for e in freq if is_junk(e)}
    keep_freq = Counter({e: c for e, c in freq.items() if e not in junk})
    mapping = build_entity_canonical_map(keep_freq, type_of, args.sim)
    print(f"{len(freq)} entities · {len(junk)} junk removed · "
          f"{len(mapping)} variants merged "
          f"(e.g. {list(mapping.items())[:3]})")

    total_dropped_edges = total_merged = 0
    for p, snap in snaps.items():
        edge_map: dict[str, dict] = {}
        dropped = 0
        for e in snap.get("edges", []):
            s = e.get("source", "")
            t = e.get("target", "")
            if s in junk or t in junk:
                dropped += 1
                continue
            s = mapping.get(s, s)
            t = mapping.get(t, t)
            if s == t:
                dropped += 1
                continue
            eid = f"{s}||{e.get('rel','')}||{t}"
            if eid in edge_map:
                ex = edge_map[eid]
                ex["weight"] = (ex.get("weight") or 1) + (e.get("weight") or 1)
                total_merged += 1
            else:
                e = dict(e)
                e["id"] = eid
                e["source"] = s
                e["target"] = t
                edge_map[eid] = e
        edges = list(edge_map.values())

        degree: Counter = Counter()
        for e in edges:
            w = e.get("weight") or 1
            degree[e["source"]] += w
            degree[e["target"]] += w

        pos = {n["id"]: n for n in snap.get("nodes", [])}
        nodes = []
        seen: set[str] = set()
        for old_id, n in pos.items():
            new_id = mapping.get(old_id, old_id)
            if old_id in junk or new_id in seen or new_id not in degree:
                continue
            seen.add(new_id)
            m = dict(n)
            m["id"] = new_id
            m["degree"] = int(degree[new_id])
            nodes.append(m)

        snap["nodes"] = nodes
        snap["edges"] = edges
        if "stats" in snap:
            snap["stats"]["nodes"] = len(nodes)
            snap["stats"]["edges"] = len(edges)
        total_dropped_edges += dropped
        print(f"  {p.stem}: {len(nodes)} nodes, {len(edges)} edges "
              f"({dropped} junk/self edges dropped)")
        if not args.dry_run:
            p.write_text(json.dumps(snap, indent=2))

    print(f"Done. {total_dropped_edges} edges dropped, {total_merged} merged"
          + (" (dry run — nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
