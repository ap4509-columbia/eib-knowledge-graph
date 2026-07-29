"""Merge new triplets into per-corpus monthly snapshot JSONs, keeping the
same shape the frontend expects (index.json / snapshots/{month}.json /
articles/{month}.json). Idempotent — safe to run daily."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx

from .sources.base import Article

_ARTICLE_SUMMARY_CHARS = 600

# ── Polarity classification (mirrors backend/runner.py) ─────────────────
_NEG_KEYWORDS = (
    "negative impact", "cuts", "cut", "misses", "miss", "lawsuit", "sues",
    "underperforms", "declines", "falls", "drops", "loses", "downgrade",
    "warns", "layoffs", "recall", "delays", "delay", "fires", "loses lead",
    "faces", "penalty", "fine", "restrict", "restricts", "declined",
    "dropped", "fell", "sued", "warning", "concern",
)
_POS_KEYWORDS = (
    "positive impact", "beats", "beat", "surges", "gains", "outperforms",
    "acquires", "acquisition", "upgrades", "upgrade", "launches", "launch",
    "partners", "partnership", "wins", "signs", "expands", "raises",
    "increases", "grows", "record", "highest", "strong", "boost", "boosts",
    "rally", "surged", "gained",
)


def _classify_polarity(rel: str) -> str:
    r = (rel or "").lower()
    for kw in _NEG_KEYWORDS:
        if kw in r:
            return "negative"
    for kw in _POS_KEYWORDS:
        if kw in r:
            return "positive"
    return "neutral"


# ── Snapshot merging ────────────────────────────────────────────────────

def _norm(s, default: str = "UNK") -> str:
    if s is None:
        return default
    s = str(s).strip()
    if not s or s.lower() in ("none", "nan"):
        return default
    return s


def _load_json(path: Path, default):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return default


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)


def _month_of(iso_date: str) -> str:
    return iso_date[:7]  # YYYY-MM


def _layout_positions(
    node_ids: list[str],
    edges: list[dict],
    canvas_size: float = 1000.0,
    seed: int = 42,
) -> dict[str, tuple[float, float]]:
    """Deterministic spring-layout so the graph opens at a fixed 'best view'."""
    if not node_ids:
        return {}
    G = nx.DiGraph()
    for eid in node_ids:
        G.add_node(eid)
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=e.get("weight", 1))

    n = G.number_of_nodes()
    k = 1.0 / (n ** 0.5) if n > 1 else 1.0
    raw = nx.spring_layout(G, k=k, iterations=120, seed=seed, weight="weight")

    xs = [p[0] for p in raw.values()]
    ys = [p[1] for p in raw.values()]
    x_range = max(xs) - min(xs) or 1.0
    y_range = max(ys) - min(ys) or 1.0
    x_mid = (max(xs) + min(xs)) / 2.0
    y_mid = (max(ys) + min(ys)) / 2.0
    scale = canvas_size / max(x_range, y_range)

    return {
        node: (
            round((pos[0] - x_mid) * scale, 2),
            round((pos[1] - y_mid) * scale, 2),
        )
        for node, pos in raw.items()
    }


def update_corpus(
    corpus_root: Path,
    corpus_name: str,
    articles: list[Article],
    triplets_by_url: dict[str, list[tuple]],
) -> dict:
    """Merge the freshly-extracted triplets into corpus_root/snapshots/*.json
    and corpus_root/articles/*.json. Returns a summary dict for logging."""

    # Group by month
    by_month: dict[str, list[tuple[Article, list[tuple]]]] = defaultdict(list)
    for a in articles:
        by_month[_month_of(a.date)].append((a, triplets_by_url.get(a.url, [])))

    months_touched: set[str] = set()
    total_new_edges = 0
    total_new_articles = 0

    for month, items in by_month.items():
        # ── Update snapshot ────────────────────────────────────────────
        snap_path = corpus_root / "snapshots" / f"{month}.json"
        snap = _load_json(snap_path, {
            "month": month,
            "stats": {"nodes": 0, "edges": 0, "scored_edges": 0},
            "nodes": [],
            "edges": [],
        })

        # Rebuild counters from existing state
        edge_counter: Counter = Counter()
        node_types: dict[str, str] = {}
        for e in snap["edges"]:
            key = (e["source"], e["target"], e["rel"], e["rel_cat"])
            edge_counter[key] = e.get("weight", 1)
        for n in snap["nodes"]:
            node_types[n["id"]] = n["type"]

        # Fold in new triplets
        for _, triplets in items:
            for t in triplets:
                sub, sub_t, rel, rel_cat, obj, obj_t = (_norm(x) for x in t)
                if not sub or not obj or not rel or sub == "UNK" or obj == "UNK":
                    continue
                sub_t = sub_t.upper()
                obj_t = obj_t.upper()
                edge_counter[(sub, obj, rel, rel_cat)] += 1
                node_types.setdefault(sub, sub_t)
                node_types.setdefault(obj, obj_t)
                total_new_edges += 1

        # Recompute degrees + serialize
        in_deg: Counter = Counter()
        out_deg: Counter = Counter()
        for (s, o, _, _), w in edge_counter.items():
            out_deg[s] += w
            in_deg[o] += w

        edges = [
            {
                "id": f"e{i}",
                "source": s,
                "target": o,
                "rel": rel,
                "rel_cat": rel_cat,
                "polarity": _classify_polarity(rel),
                "weight": w,
                "score": None,
            }
            for i, ((s, o, rel, rel_cat), w) in enumerate(edge_counter.items())
        ]

        positions = _layout_positions(list(node_types.keys()), edges)

        nodes = [
            {
                "id": e,
                "type": t,
                "degree": in_deg[e] + out_deg[e],
                "x": positions.get(e, (0.0, 0.0))[0],
                "y": positions.get(e, (0.0, 0.0))[1],
            }
            for e, t in node_types.items()
        ]

        snap = {
            "month": month,
            "stats": {"nodes": len(nodes), "edges": len(edges), "scored_edges": 0},
            "nodes": nodes,
            "edges": edges,
        }
        _write_json(snap_path, snap)

        # ── Update articles for the month ──────────────────────────────
        art_path = corpus_root / "articles" / f"{month}.json"
        existing_articles = _load_json(art_path, [])
        existing_urls = {a["url"] for a in existing_articles}

        for a, _ in items:
            if a.url in existing_urls:
                continue
            summary = (a.text or "")[:_ARTICLE_SUMMARY_CHARS]
            existing_articles.append(
                {
                    "date": a.date,
                    "title": a.title,
                    "ticker": a.ticker,
                    "url": a.url,
                    "summary": summary,
                }
            )
            total_new_articles += 1

        # Sort by date desc for stable reads
        existing_articles.sort(key=lambda r: r["date"], reverse=True)
        _write_json(art_path, existing_articles)

        months_touched.add(month)

    # ── Refresh corpus index.json ──────────────────────────────────────
    all_months = sorted(p.stem for p in (corpus_root / "snapshots").glob("*.json"))
    index = {
        "corpus": corpus_name,
        "months": all_months,
        "latest": all_months[-1] if all_months else None,
        "hasScores": [],
        "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _write_json(corpus_root / "index.json", index)

    return {
        "corpus": corpus_name,
        "months_touched": sorted(months_touched),
        "new_articles": total_new_articles,
        "new_edges": total_new_edges,
    }


def refresh_corpora_manifest(data_root: Path) -> dict:
    """Rebuild /data/corpora.json — a lightweight registry of every corpus
    that currently has data. The frontend can fetch this to populate a
    corpus-picker dropdown."""
    corpora: list[dict] = []
    for child in sorted(data_root.iterdir()):
        if not child.is_dir():
            continue
        idx = child / "index.json"
        if not idx.exists():
            continue
        info = _load_json(idx, {})
        if not info.get("months"):
            continue
        corpora.append(
            {
                "id": child.name,
                "months": info.get("months", []),
                "latest": info.get("latest"),
                "last_updated": info.get("last_updated"),
            }
        )
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpora": corpora,
    }
    _write_json(data_root / "corpora.json", manifest)
    return manifest
