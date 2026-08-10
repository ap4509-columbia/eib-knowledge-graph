"""Enriched-snapshot writer for the factor-model pipeline.

Distinct from snapshots.py (which serialises the old 6-tuple triplets for
the existing team pipeline). This writer takes enriched triplet-dicts —
each carrying sentiment / materiality / event_type — and produces:

  frontend/public/data/sources/<sourceId>/
    index.json                              # months + latest
    snapshots/<YYYY-MM>.json                # KG snapshot for the month
    articles/<YYYY-MM>.json                 # article corpus for the month
    factors/<YYYY-MM-DD>.json               # per-day factor loadings + PCA + clusters

The KG snapshot format is compatible with the existing frontend types
(nodes/edges), but edges additionally carry sentiment / materiality_usd /
event_type. The frontend can ignore those extras or use them for visual
mapping.
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import networkx as nx

from scraper.sources.base import Article


def _load_json(path: Path, default):
    if not path.exists():
        return default
    with open(path) as f:
        return json.load(f)


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, default=str)
    tmp.replace(path)


def _edge_id(src: str, tgt: str, rel: str) -> str:
    # Stable ID so re-runs on the same day dedupe naturally.
    return f"{src}||{rel}||{tgt}"


def _classify_causal_type(rel: str) -> str:
    """Same 8-family bucketing used by the existing runner, kept here to
    avoid importing from backend/. Extracted verb → causal family for edge
    colouring on the KG tab."""
    r = (rel or "").lower()
    if any(w in r for w in ("acquire", "buy", "purchase", "merge", "divest", "sell stake", "sell business")):
        return "CORPORATE_ACTION"
    if any(w in r for w in ("compete", "outperform", "underperform", "loses share", "takes share")):
        return "COMPETITIVE"
    if any(w in r for w in ("report", "beat", "miss", "generate", "revenue", "earnings", "guidance")):
        return "FINANCIAL_METRIC"
    if any(w in r for w in ("sue", "regulate", "file against", "fine", "investigate", "ban")):
        return "REGULATORY"
    if any(w in r for w in ("launch", "release", "produce", "use", "supply", "manufactures", "deliver")):
        return "OPERATIONAL"
    if any(w in r for w in ("is-a", "has ticker", "part of", "includes", "member of", "listed on")):
        return "STRUCTURAL"
    if any(w in r for w in ("cause", "impact", "drive", "influence", "affect", "trigger")):
        return "CAUSAL"
    return "OTHER"


def _layout_positions(G: nx.DiGraph) -> dict[str, tuple[float, float]]:
    """Deterministic spring layout so the frontend can render at final view
    instantly."""
    if G.number_of_nodes() == 0:
        return {}
    try:
        return nx.spring_layout(G, seed=42, k=None, iterations=50)
    except Exception:
        return {}


def _build_month_snapshot(
    month: str,
    articles: list[Article],
    triplets_by_url: dict[str, list[dict]],
) -> dict:
    """Fold the month's articles + triplets into the KG snapshot JSON."""
    # Aggregate: (src, rel, tgt) → {count, sentiments, materialities, event_types, articles}
    edges_agg: dict[tuple[str, str, str], dict] = defaultdict(
        lambda: {
            "count": 0,
            "sentiments": [],
            "materialities": [],
            "event_types": [],
            "article_urls": set(),
            "sub_type": "UNK",
            "obj_type": "UNK",
            "rel_category": "UNK",
        }
    )
    node_types: dict[str, str] = {}
    node_articles: dict[str, set[str]] = defaultdict(set)

    for art in articles:
        triplets = triplets_by_url.get(art.url, [])
        for t in triplets:
            src = t.get("sub")
            tgt = t.get("obj")
            rel = t.get("rel")
            if not (src and tgt and rel):
                continue
            k = (src, rel, tgt)
            e = edges_agg[k]
            e["count"] += 1
            e["article_urls"].add(art.url)
            e["sub_type"] = t.get("sub_type", e["sub_type"])
            e["obj_type"] = t.get("obj_type", e["obj_type"])
            e["rel_category"] = t.get("rel_category", e["rel_category"])
            if isinstance(t.get("sentiment"), (int, float)):
                e["sentiments"].append(float(t["sentiment"]))
            m = t.get("materiality_usd")
            if isinstance(m, (int, float)) and m > 0:
                e["materialities"].append(float(m))
            if isinstance(t.get("event_type"), str):
                e["event_types"].append(t["event_type"])

            node_types[src] = t.get("sub_type", node_types.get(src, "UNK"))
            node_types[tgt] = t.get("obj_type", node_types.get(tgt, "UNK"))
            node_articles[src].add(art.url)
            node_articles[tgt].add(art.url)

    # Build a NetworkX graph for layout
    G = nx.DiGraph()
    for n in node_types:
        G.add_node(n)
    for (src, rel, tgt) in edges_agg.keys():
        G.add_edge(src, tgt)
    positions = _layout_positions(G)

    # Scale layout for readability
    SCALE = 900
    def _pos(n: str) -> tuple[float, float]:
        p = positions.get(n)
        if not p:
            return (0.0, 0.0)
        return (float(p[0]) * SCALE, float(p[1]) * SCALE)

    nodes = []
    for n, t in node_types.items():
        x, y = _pos(n)
        nodes.append(
            {
                "id": n,
                "type": t,
                "degree": int(G.in_degree(n) + G.out_degree(n)),
                "x": x,
                "y": y,
            }
        )

    edges = []
    for (src, rel, tgt), e in edges_agg.items():
        sentiment_mean = float(sum(e["sentiments"]) / len(e["sentiments"])) if e["sentiments"] else 0.0
        materiality_sum = float(sum(e["materialities"])) if e["materialities"] else 0.0
        # Log-scale materiality so the numbers are comparable to sentiment/count
        materiality_log = float(math.log1p(materiality_sum))
        event_type_top = Counter(e["event_types"]).most_common(1)[0][0] if e["event_types"] else "OTHER"
        edges.append(
            {
                "id": _edge_id(src, tgt, rel),
                "source": src,
                "target": tgt,
                "rel": rel,
                "rel_cat": e["rel_category"],
                "causal_type": _classify_causal_type(rel),
                "polarity": (
                    "positive" if sentiment_mean > 0.15
                    else "negative" if sentiment_mean < -0.15
                    else "neutral"
                ),
                "origin": "news",
                "weight": int(e["count"]),
                "score": None,
                # Enriched fields — used by Factor Analysis tab and (later)
                # by richer edge styling on the KG tab.
                "sentiment": round(sentiment_mean, 3),
                "materiality_usd": round(materiality_sum, 2),
                "materiality_log": round(materiality_log, 3),
                "event_type": event_type_top,
            }
        )

    return {
        "month": month,
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "scored_edges": 0,
        },
        "nodes": nodes,
        "edges": edges,
    }


def update_corpus_enriched(
    corpus_root: Path,
    corpus_name: str,
    articles: list[Article],
    triplets_by_url: dict[str, list[dict]],
    factors_bundle: dict,
) -> dict:
    """Merge fresh extractions into per-month snapshot + article files and
    write today's factors bundle. Returns a summary dict."""
    corpus_root.mkdir(parents=True, exist_ok=True)

    # Group articles by month
    by_month: dict[str, list[Article]] = defaultdict(list)
    for art in articles:
        by_month[art.date[:7]].append(art)  # "YYYY-MM"

    summary = {"corpus": corpus_name, "months_updated": []}

    for month, month_articles in by_month.items():
        # Merge with any existing month articles + triplets
        existing_arts_path = corpus_root / "articles" / f"{month}.json"
        existing_arts = _load_json(existing_arts_path, [])
        existing_urls = {a.get("url") for a in existing_arts}

        new_arts_dicts = [a.to_dict() for a in month_articles if a.url not in existing_urls]
        merged_arts_dicts = existing_arts + new_arts_dicts
        _write_json(existing_arts_path, merged_arts_dicts)

        # Rebuild the month snapshot from the merged articles.
        # For merged old articles we don't have their triplets in-memory, so
        # they contribute only as article records — the KG structure for the
        # month is only whatever's currently produced from THIS run's fresh
        # articles. This is imperfect but avoids maintaining a triplet cache
        # across days; a future improvement is to persist triplets per URL.
        month_snapshot = _build_month_snapshot(
            month=month,
            articles=month_articles,
            triplets_by_url=triplets_by_url,
        )
        snap_path = corpus_root / "snapshots" / f"{month}.json"

        # If a prior snapshot exists (e.g. from an earlier day this month),
        # merge nodes + edges instead of overwriting outright.
        prior = _load_json(snap_path, None)
        if prior:
            month_snapshot = _merge_snapshots(prior, month_snapshot)
        _write_json(snap_path, month_snapshot)
        summary["months_updated"].append(month)

    # Update index.json
    snap_dir = corpus_root / "snapshots"
    months = sorted([p.stem for p in snap_dir.glob("*.json")])
    index = {
        "months": months,
        "latest": months[-1] if months else None,
        "hasScores": [],
        "source": corpus_name,
    }
    _write_json(corpus_root / "index.json", index)

    # Today's factor bundle
    today = date.today().isoformat()
    factors_bundle = dict(factors_bundle)
    factors_bundle["generated_at"] = datetime.now(timezone.utc).isoformat()
    factors_bundle["corpus"] = corpus_name
    factors_bundle["date"] = today
    _write_json(corpus_root / "factors" / f"{today}.json", factors_bundle)

    # Also maintain a "factors/latest.json" for the UI to fetch without
    # knowing today's date first.
    _write_json(corpus_root / "factors" / "latest.json", factors_bundle)

    summary["factors_written"] = today
    summary["entities_in_factors"] = len(factors_bundle.get("entities", []))
    return summary


def _merge_snapshots(prior: dict, fresh: dict) -> dict:
    """Union nodes + edges from prior and fresh snapshots of the same month."""
    if not prior:
        return fresh
    if not fresh:
        return prior

    node_map = {n["id"]: n for n in prior.get("nodes", [])}
    for n in fresh.get("nodes", []):
        if n["id"] not in node_map:
            node_map[n["id"]] = n

    edge_map = {e["id"]: e for e in prior.get("edges", [])}
    for e in fresh.get("edges", []):
        if e["id"] in edge_map:
            # Update: sum counts, average sentiment, keep max materiality
            existing = edge_map[e["id"]]
            existing["weight"] = existing.get("weight", 0) + e.get("weight", 0)
            existing["sentiment"] = round(
                (existing.get("sentiment", 0.0) + e.get("sentiment", 0.0)) / 2, 3
            )
            existing["materiality_usd"] = max(
                existing.get("materiality_usd", 0.0), e.get("materiality_usd", 0.0)
            )
        else:
            edge_map[e["id"]] = e

    nodes = list(node_map.values())
    edges = list(edge_map.values())
    return {
        "month": fresh["month"],
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "scored_edges": 0,
        },
        "nodes": nodes,
        "edges": edges,
    }
