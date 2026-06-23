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

# Output directory (consumed by the API). Cleared and rewritten on every run.
OUT_DIR = _BACKEND_DIR / "data"
SNAPSHOTS_DIR = OUT_DIR / "snapshots"
INDEX_FILE = OUT_DIR / "index.json"


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

        nodes = [
            {"id": e, "type": t, "degree": in_deg[e] + out_deg[e]}
            for e, t in node_types.items()
        ]
        edges = [
            {
                "id": f"e{i}",
                "source": sub,
                "target": obj,
                "rel": rel,
                "rel_cat": rel_cat,
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


def write_outputs(snapshots: dict[str, dict]) -> dict:
    """Write per-month JSON + the index manifest."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    # Clear stale snapshots
    for old in SNAPSHOTS_DIR.glob("*.json"):
        old.unlink()

    months = sorted(snapshots.keys())
    for month in months:
        with open(SNAPSHOTS_DIR / f"{month}.json", "w") as f:
            json.dump(snapshots[month], f)

    index = {
        "months": months,
        "latest": months[-1] if months else None,
        "hasScores": [],  # populated when GAT scoring is wired in
        "source": str(SOURCE_CSV),
    }
    with open(INDEX_FILE, "w") as f:
        json.dump(index, f, indent=2)
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
