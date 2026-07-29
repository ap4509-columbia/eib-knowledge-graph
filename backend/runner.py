"""
Runner: reads triplet CSVs from the Spring 2026 team's pipeline output and
produces the JSON snapshots the UI consumes.

CSV columns expected:
    date, output_triplets

Each `output_triplets` cell is a stringified Python list of 6-tuples:
    (sub, sub_type, rel, rel_category, obj, obj_type)

Output JSON shape (per-snapshot) matches `frontend/lib/api/types.ts`.
"""

from __future__ import annotations

import ast
import json
import time
from collections import Counter
from pathlib import Path
from typing import Optional

import networkx as nx
import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────

# Source CSV (the past team's output). Override via env var SOURCE_CSV if needed.
import os

_BACKEND_DIR = Path(__file__).parent
# backend/ → eib-knowledge-graph/ → summer 26/ → project/ → past teams work/
_DEFAULT_SOURCE = (
    _BACKEND_DIR.parent.parent.parent
    / "past teams work"
    / "Deliverables_Spring 2026"
    / "output"
    / "summary_triplets_19_20.csv"
)
SOURCE_CSV = Path(os.environ.get("SOURCE_CSV", _DEFAULT_SOURCE))

# Output directory (consumed by the local API). Cleared and rewritten on every run.
OUT_DIR = _BACKEND_DIR / "data"
SNAPSHOTS_DIR = OUT_DIR / "snapshots"
INDEX_FILE = OUT_DIR / "index.json"

# Mirror output for static-only Vercel deploys. Same files served straight
# from the CDN with no backend at runtime.
_FRONTEND_PUBLIC = _BACKEND_DIR.parent / "frontend" / "public" / "data"
PUBLIC_SNAPSHOTS_DIR = _FRONTEND_PUBLIC / "snapshots"
PUBLIC_ARTICLES_DIR = _FRONTEND_PUBLIC / "articles"
PUBLIC_INDEX_FILE = _FRONTEND_PUBLIC / "index.json"

# How much of each article summary to bundle for client-side keyword search.
# Matches the backend's previous truncation length so search behavior is identical.
_ARTICLE_SUMMARY_CHARS = 600


# ── Parsing helpers ────────────────────────────────────────────────────

def _parse_triplets(raw) -> list[tuple]:
    """Parse the stringified Python list. Return [] on any failure."""
    if not isinstance(raw, str) or not raw:
        return []
    try:
        parsed = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return []
    if not isinstance(parsed, list):
        return []
    out = []
    for t in parsed:
        if isinstance(t, (tuple, list)) and len(t) == 6:
            out.append(tuple(t))
    return out


def _norm(s, default: str = "UNK") -> str:
    """Normalize a string field; collapse None / empty / NaN to default."""
    if s is None:
        return default
    s = str(s).strip()
    if not s or s.lower() in ("none", "nan"):
        return default
    return s


# ── Polarity classification ────────────────────────────────────────────
# Keyword lists. Matched case-insensitively against the relation verb.

_NEGATIVE_KEYWORDS = (
    "negative impact",
    "decrease",
    "decline",
    "drop",
    "fall",
    "miss",
    "cut",
    "lose",
    "loss",
    "lost",
    "weak",
    "underperform",
    "downgrade",
    "lower",
    "sue",
    "fine",
    "restrict",
    "ban",
    "warn",
    "concern",
    "fear",
    "doubt",
    "delay",
    "halt",
    "fail",
    "below",
    "default",
    "bankrupt",
    "deteriorat",
    "shrink",
    "slow",
)

_POSITIVE_KEYWORDS = (
    "positive impact",
    "increase",
    "rise",
    "grow",
    "gain",
    "surge",
    "rally",
    "jump",
    "beat",
    "surpass",
    "exceed",
    "outperform",
    "upgrade",
    "raise",
    "boost",
    "expand",
    "acquire",
    "partner",
    "launch",
    "innovat",
    "lead",
    "announce",  # often-positive in finance news (announcements skew bullish)
    "approve",
    "accelerat",
    "strong",
    "recover",
    "improve",
    "support",
)


def _classify_polarity(rel: str) -> str:
    """Classify a relation verb into 'negative' / 'neutral' / 'positive'."""
    if not rel:
        return "neutral"
    r = rel.lower()
    has_neg = any(kw in r for kw in _NEGATIVE_KEYWORDS)
    has_pos = any(kw in r for kw in _POSITIVE_KEYWORDS)
    if has_neg and not has_pos:
        return "negative"
    if has_pos and not has_neg:
        return "positive"
    return "neutral"


# ── Snapshot builder ───────────────────────────────────────────────────

def build_snapshots(source_csv: Path = None) -> dict[str, dict]:
    """
    Read the triplet CSV, group by month, build a JSON snapshot per month.
    Returns: { '2019-01': snapshot_dict, ... }
    """
    if source_csv is None:
        source_csv = SOURCE_CSV
    if not source_csv.exists():
        raise FileNotFoundError(f"Source CSV not found: {source_csv}")

    df = pd.read_csv(source_csv, low_memory=False)
    df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)
    df = df.dropna(subset=["date", "output_triplets"])
    df["month"] = df["date"].dt.to_period("M").astype(str)

    snapshots: dict[str, dict] = {}

    for month, month_df in df.groupby("month"):
        edge_counter: Counter = Counter()
        node_types: dict[str, str] = {}

        for raw in month_df["output_triplets"]:
            for sub, sub_t, rel, rel_cat, obj, obj_t in _parse_triplets(raw):
                sub = _norm(sub, default="")
                obj = _norm(obj, default="")
                rel = _norm(rel, default="")
                if not sub or not obj or not rel:
                    continue
                rel_cat = _norm(rel_cat)
                sub_t = _norm(sub_t).upper()
                obj_t = _norm(obj_t).upper()
                edge_counter[(sub, obj, rel, rel_cat)] += 1
                node_types.setdefault(sub, sub_t)
                node_types.setdefault(obj, obj_t)

        if not node_types:
            continue

        in_deg: Counter = Counter()
        out_deg: Counter = Counter()
        for (sub, obj, _, _), w in edge_counter.items():
            out_deg[sub] += w
            in_deg[obj] += w

        # Compute a deterministic, precomputed layout so the graph loads
        # at a fixed "best view" on every reload instead of settling from
        # random init. Positions live directly in the node data; the
        # frontend uses Cytoscape's `preset` layout to place them instantly.
        positions = _layout_positions(node_types, edge_counter)

        nodes = [
            {
                "id": e,
                "type": t,
                "degree": in_deg[e] + out_deg[e],
                "x": positions[e][0],
                "y": positions[e][1],
            }
            for e, t in node_types.items()
        ]
        edges = [
            {
                "id": f"e{i}",
                "source": sub,
                "target": obj,
                "rel": rel,
                "rel_cat": rel_cat,
                "polarity": _classify_polarity(rel),
                "weight": w,
                "score": None,  # GAT scoring added later
            }
            for i, ((sub, obj, rel, rel_cat), w) in enumerate(edge_counter.items())
        ]

        snapshots[month] = {
            "month": month,
            "stats": {
                "nodes": len(nodes),
                "edges": len(edges),
                "scored_edges": 0,
            },
            "nodes": nodes,
            "edges": edges,
        }

    return snapshots


def _layout_positions(
    node_types: dict[str, str],
    edge_counter: Counter,
    canvas_size: float = 1000.0,
    seed: int = 42,
) -> dict[str, tuple[float, float]]:
    """Deterministic force-directed layout via networkx.

    Positions are scaled to fit inside [-canvas_size/2, canvas_size/2] on both
    axes and delivered as (x, y) tuples. Same input graph → same layout every
    time (fixed seed).

    Frontend loads these with Cytoscape's `preset` layout so nodes appear at
    their final positions instantly, no settling animation.
    """
    G = nx.DiGraph()
    for entity in node_types:
        G.add_node(entity)
    for (sub, obj, _, _), w in edge_counter.items():
        G.add_edge(sub, obj, weight=int(w))

    if G.number_of_nodes() == 0:
        return {}

    n = G.number_of_nodes()
    # k = optimal distance between nodes; scales inversely with sqrt(n)
    # so bigger graphs stay legible. iterations gives the layout time to
    # actually reach a settled state (default 50 is often too shallow).
    k = 1.0 / (n ** 0.5) if n > 1 else 1.0
    raw = nx.spring_layout(G, k=k, iterations=120, seed=seed, weight="weight")

    # Rescale into pixel-ish coordinates centered on 0
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


def _build_articles_by_month(source_csv: Path) -> dict[str, list[dict]]:
    """Slim per-month article corpus for client-side search.
    Keeps only fields the search needs (date/title/ticker/url/summary).
    """
    df = pd.read_csv(source_csv, low_memory=False)
    df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)
    df = df.dropna(subset=["date"])
    df["month"] = df["date"].dt.to_period("M").astype(str)

    out: dict[str, list[dict]] = {}
    for month, month_df in df.groupby("month"):
        rows = []
        for _, row in month_df.iterrows():
            summary = (row.get("summary") or "")
            if not isinstance(summary, str):
                summary = ""
            rows.append(
                {
                    "date": str(row["date"].date()),
                    "title": _norm(row.get("title"), default=""),
                    "ticker": _norm(row.get("ticker"), default=""),
                    "url": (row.get("url") or "") if isinstance(row.get("url"), str) else "",
                    "summary": summary[:_ARTICLE_SUMMARY_CHARS],
                }
            )
        out[month] = rows
    return out


def write_outputs(snapshots: dict[str, dict]) -> dict:
    """Write per-month snapshot JSONs, the index manifest, and the per-month
    article corpus. Writes to both the backend cache and the frontend's
    public/data tree so Vercel can serve everything as static files.
    """
    # ── Backend cache (consumed by /api/* endpoints when running locally) ──
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    for old in SNAPSHOTS_DIR.glob("*.json"):
        old.unlink()

    months = sorted(snapshots.keys())
    for month in months:
        with open(SNAPSHOTS_DIR / f"{month}.json", "w") as f:
            json.dump(snapshots[month], f)

    index = {
        "months": months,
        "latest": months[-1] if months else None,
        "hasScores": [],
        "source": str(SOURCE_CSV),
    }
    with open(INDEX_FILE, "w") as f:
        json.dump(index, f, indent=2)

    # ── Frontend public mirror (consumed at runtime on Vercel) ─────────────
    PUBLIC_SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_ARTICLES_DIR.mkdir(parents=True, exist_ok=True)
    for old in PUBLIC_SNAPSHOTS_DIR.glob("*.json"):
        old.unlink()
    for old in PUBLIC_ARTICLES_DIR.glob("*.json"):
        old.unlink()

    for month in months:
        with open(PUBLIC_SNAPSHOTS_DIR / f"{month}.json", "w") as f:
            json.dump(snapshots[month], f)
    with open(PUBLIC_INDEX_FILE, "w") as f:
        json.dump(index, f, indent=2)

    # Article corpus for client-side search
    articles_by_month = _build_articles_by_month(SOURCE_CSV)
    for month, rows in articles_by_month.items():
        with open(PUBLIC_ARTICLES_DIR / f"{month}.json", "w") as f:
            json.dump(rows, f)

    return index


# ── Public API used by main.py ─────────────────────────────────────────

def run() -> dict:
    """Full runner: parse CSV → build snapshots → write JSON. Returns the index + timing."""
    t0 = time.time()
    snapshots = build_snapshots()
    index = write_outputs(snapshots)
    index["duration_ms"] = int((time.time() - t0) * 1000)
    return index


def get_index() -> dict:
    """Return the cached index, running the pipeline once if it doesn't exist."""
    if INDEX_FILE.exists():
        with open(INDEX_FILE) as f:
            return json.load(f)
    return run()


def get_snapshot(month: str) -> Optional[dict]:
    """Return the snapshot JSON for a given month, or None if not built."""
    path = SNAPSHOTS_DIR / f"{month}.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


# ── CLI ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    print(f"Source CSV: {SOURCE_CSV}")
    if not SOURCE_CSV.exists():
        print(f"ERROR: source file not found", file=sys.stderr)
        sys.exit(1)

    print("Running…")
    result = run()
    print(f"Built {len(result['months'])} snapshots in {result['duration_ms']} ms")
    if result["months"]:
        sample = result["months"][0]
        snap = get_snapshot(sample)
        print(f"Sample month {sample}: {snap['stats']}")
