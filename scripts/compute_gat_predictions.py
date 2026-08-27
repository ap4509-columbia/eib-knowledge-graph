"""Consume the CE No-Edge-Feats GAT checkpoints (the winner of the
`strategy=original` leaderboard, MRR 0.7746) and produce a FinDKG-style
per-month predictions JSON for the frontend.

Output: frontend/public/data/predictions.json — one entry per period, each
listing the top-N entities with rank percentile, novelty z-score, 3-month
trend, and top-K predicted-impacted financial entities.

Requires Pierre's fork on disk (weights + gat_model + gat_utils), and the
2019-2020 triplets CSV those weights were trained on.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
import torch

# The eib pipeline repo provides the model + feature builders. Overridable
# via --eib-root (or EIB_ROOT env) so the same script runs on the VM.
EIB_EVAL_ROOT = Path(
    os.environ.get("EIB_ROOT", "/Users/alexandrapaiz/Desktop/eib-eval/eib")
).expanduser()
sys.path.insert(0, str(EIB_EVAL_ROOT))

from components.gat_model import GATLP  # noqa: E402
from utils.data_utils import load_df_from_csv  # noqa: E402
from utils.gat_utils import (  # noqa: E402
    build_node_features,
    build_rel_category_map,
    build_rel_map,
    build_type_map,
    pack_pyg_data,
)

# ── Config ────────────────────────────────────────────────────────────────
TRIPLETS_CSV = EIB_EVAL_ROOT / "output" / "summary_triplets_19_20.csv"
WEIGHTS_DIR = EIB_EVAL_ROOT / "weights" / "ce_noedge_original"
STRATEGY = "original"
USE_EDGE_TYPES = False  # winning config was "No Edge Feats"

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "public"
    / "data"
    / "predictions.json"
)

TOP_ENTITIES_PER_PERIOD = 40
TOP_IMPACTED_PER_ENTITY = 5

# Every entity type worth exposing in the leaderboard. Everything except
# UNK is included so the analyst can filter to whichever slice they want
# via the graph-tab filter rail (which now drives both views). The old
# narrow default is preserved as ANALYST_DEFAULT_TYPES for the initial
# render — but the raw data ships every type so the filter can widen.
SOURCE_TYPES = {
    "COMPANY",
    "STOCKTICKER",
    "STOCK_TICKER",
    "FINANCIALENTITY",
    "FINANCIAL_ENTITY",
    "SECTOR",
    "BOND",
    "CONCEPT",
    "EVENT",
    "PRODUCT",
    "MACROINDICATOR",
    "MACRO_INDICATOR",
    "ECONINDICATOR",
    "ECON_INDICATOR",
    "FININSTRUMENTINFO",
    "FIN_INSTRUMENT_INFO",
    "DERIVATIVE",
    "CURRENCY",
    "PERSON",
    "COUNTRY",
    "LOCATION",
    "INSTITUTION",
}

# Impacted-target types — same wide set; caller filters client-side.
IMPACTED_TYPES = set(SOURCE_TYPES)

# Types that may OCCUPY leaderboard ranking slots. Hub concepts ("Earnings
# Report") touch everything, so ranking by connectivity floats them to the
# top where they carry zero analyst meaning — and they crowd concrete
# entities out of the fixed top-N. Concepts, events, and instrument
# boilerplate still appear as predicted co-movers (informative there:
# "NVDA → AI chip demand"), just never as ranked rows.
RANKED_TYPES = {
    "COMPANY",
    "STOCKTICKER",
    "STOCK_TICKER",
    "FINANCIALENTITY",
    "FINANCIAL_ENTITY",
    "SECTOR",
    "INSTITUTION",
    "PERSON",
    "COUNTRY",
    "LOCATION",
    "PRODUCT",
}

# Regex families for junk entities the LLM extractor emits.
JUNK_PATTERNS = [
    re.compile(r"^\d+$"),                                    # "50", "1840"
    re.compile(r"^\d+\.?\d*\s*(k|m|b|bn|billion|million|trillion)?\s*(usd|eur|gbp|dollars)?$", re.I),
    re.compile(r"^\d+\s*Strike\s*(Call|Put)\s*Option$", re.I),
    re.compile(r"^\d+\s*USD$", re.I),
    # Quarterly-reporting boilerplate: "Q1 2021", "Q3 Loss", "SecondQuarter …",
    # "FirstQuarter …", "Next Quarter EPS", "Fiscal FirstQuarter Revenue".
    re.compile(r"^Q[1-4]\b", re.I),
    re.compile(r"^(First|Second|Third|Fourth|Next)\s?Quarter\b", re.I),
    re.compile(r"^Fiscal\s+(First|Second|Third|Fourth)\s?Quarter\b", re.I),
    re.compile(r"^Quarterly\b", re.I),
    # Percent-only strings the extractor tags as entities: "129 Percent".
    re.compile(r"^\d+\s*Percent$", re.I),
]

# Generic-phrase blocklist — LLM-emitted noise that passed type filtering.
# Curated from a survey of the previous prediction output.
GENERIC_NAME_BLOCKLIST = {
    # Prices
    "stock price", "stock prices", "ipo price", "share price", "price",
    # Company boilerplate
    "company performance", "financial performance", "profitability",
    "revenue decline", "revenue drop", "revenue growth", "revenue",
    "cash per share amount", "cash dividend",
    # After-hours movement
    "extended hours gains", "extended hours losses",
    "extendedhours gains", "extendedhours losses",
    # Margins / earnings
    "operating margin", "gross margin", "gross margins", "margins", "margin",
    "net income", "earnings", "adjusted earnings", "earnings per share",
    "profit", "profits", "growth", "growth rate", "sales", "sales growth",
    # Forecasts / estimates
    "forecast", "guidance", "analyst estimates", "estimates", "estimate",
    # Returns / values
    "value", "year to date performance", "annualized total return",
    # Generic sector names
    "chip stocks", "tech stocks", "semiconductor stocks",
    # Earnings/reporting boilerplate (surfaced by the 2009-2016 corpus)
    "earnings report", "earnings reports", "earnings beat", "earnings miss",
    "earnings call", "earnings growth", "earnings growth forecast",
    "quarterly results", "financial results", "results", "h1 results",
    "shareholder value", "dividend quality", "potential upside",
    "buy range", "price target", "price targets", "mean recommendation",
    "industry average", "outlook", "activity", "analysts", "investors",
    "retail investors", "wall street", "wall street analyst",
    "wall street analysts",
}

# Pattern-shaped boilerplate ("Zacks Rank 2", "52-Week High").
GENERIC_NAME_PATTERNS = [
    re.compile(r"^zacks\s+rank\b", re.I),
    re.compile(r"^\d+-?\s*week\s+(high|low)s?$", re.I),
]


def is_junk_entity(name: str) -> bool:
    """True if the entity string is extraction noise, not a real entity."""
    if not name or not name.strip():
        return True
    if name.lower() in GENERIC_NAME_BLOCKLIST:
        return True
    for p in GENERIC_NAME_PATTERNS:
        if p.match(name.strip()):
            return True
    for p in JUNK_PATTERNS:
        if p.match(name.strip()):
            return True
    return False


def normalise_name(name: str) -> str:
    """Cheap normalisation for the near-alias dedupe pass."""
    n = name.lower()
    # Drop common corporate suffixes so "Texas Instruments Inc" ≈ "Texas Instruments".
    for suffix in [" inc", " inc.", " corp", " corp.", " co.", " co", " ltd",
                   " ltd.", " plc", " sa", " nv", " ag", " gmbh", " llc"]:
        if n.endswith(suffix):
            n = n[: -len(suffix)]
    return re.sub(r"[^a-z0-9]", "", n)


def build_graph(df_slice: pd.DataFrame, rel2id, cat2id) -> nx.DiGraph:
    G = nx.DiGraph()
    for _, r in df_slice.iterrows():
        u, v = r["sub"], r["obj"]
        G.add_node(u, node_type=r.get("sub_type", "UNK"))
        G.add_node(v, node_type=r.get("obj_type", "UNK"))
        G.add_edge(
            u,
            v,
            rel_id=int(rel2id.get(r["rel"], 0)),
            cat_id=int(cat2id.get(r["rel_category"], 0)),
            w=float(r.get("w", 1.0)),
        )
    return G


def compute_novelty(
    df: pd.DataFrame,
    period: str,
    entities: list[str],
) -> dict[str, float]:
    """Novelty z-score per entity for `period`.

    Signal: how much the entity's activity in the last 3 months exceeds its
    prior-history baseline, standardized across all entities present in the
    period. Positive z = spiking / newly-hot; near zero = business-as-usual;
    negative z = quieting down.

    Cold-start note: entities with no prior history get raw_score = recent_3m
    directly (no baseline to subtract), which yields the largest positive
    z-scores — exactly the "novel" signal we want to surface.
    """
    all_periods = sorted(df["period"].unique())
    if period not in all_periods:
        return {e: 0.0 for e in entities}

    p_idx = all_periods.index(period)
    recent = set(all_periods[max(0, p_idx - 2) : p_idx + 1])  # 3-month window ending in period
    prior = set(all_periods[: max(0, p_idx - 2)])

    per_ent_recent = {}
    per_ent_prior_mean = {}
    for e in entities:
        e_rows = df[(df["sub"] == e) | (df["obj"] == e)]
        recent_ct = e_rows[e_rows["period"].isin(recent)].shape[0]
        prior_ct = e_rows[e_rows["period"].isin(prior)].shape[0]
        per_ent_recent[e] = recent_ct
        per_ent_prior_mean[e] = prior_ct / max(1, len(prior)) if prior else 0.0

    raw = np.array([per_ent_recent[e] - per_ent_prior_mean[e] for e in entities], dtype=float)
    mu, sigma = raw.mean(), raw.std()
    if sigma < 1e-6:
        return {e: 0.0 for e in entities}
    z = (raw - mu) / sigma
    return {e: float(z[i]) for i, e in enumerate(entities)}


def compute_trend_3m(
    df: pd.DataFrame,
    period: str,
    entities: list[str],
) -> dict[str, list[int]]:
    """Per-entity edge count for the [P-2, P-1, P] window.

    Renders as a sparkline in the UI. Zero-fills the left side if the
    period is at the start of the corpus.
    """
    all_periods = sorted(df["period"].unique())
    p_idx = all_periods.index(period)
    window = [
        all_periods[i] if i >= 0 else None
        for i in (p_idx - 2, p_idx - 1, p_idx)
    ]

    trend = {e: [0, 0, 0] for e in entities}
    for slot, p in enumerate(window):
        if p is None:
            continue
        p_rows = df[df["period"] == p]
        for e in entities:
            trend[e][slot] = int(
                ((p_rows["sub"] == e) | (p_rows["obj"] == e)).sum()
            )
    return trend


def compute_period_predictions(
    period: str,
    df: pd.DataFrame,
    rel2id,
    cat2id,
    type2id,
    node2id,
    id2type,
) -> dict:
    """One period's GAT-driven leaderboard.

    Steps: rebuild the period's graph → run GAT with that period's checkpoint
    → dot-product all node embeddings → rank source entities by aggregate
    outgoing prediction strength → for each top source, pick top financial
    targets by dot score → attach novelty + trend metadata.
    """
    weight_path = WEIGHTS_DIR / f"{period}.pt"
    if not weight_path.exists():
        return None

    month_df = df[df["period"] == period]
    if month_df.empty:
        return None

    G = build_graph(month_df, rel2id, cat2id)
    node_map = {u: G.nodes[u].get("node_type", "UNK") for u in G.nodes()}
    X, nodes_list, type_ids = build_node_features(G, node_map, type2id)

    data, _ = pack_pyg_data(
        G, X, nodes_list, type_ids, type2id, node_map,
        len(rel2id), len(cat2id), use_edge_types=USE_EDGE_TYPES,
    )
    global_ids = torch.tensor(
        [node2id.get(u, 0) for u in nodes_list], dtype=torch.long
    )
    data.n_id = global_ids

    in_ch = X.shape[1]
    model = GATLP(
        in_ch=in_ch,
        hid=256,
        num_classes=len(type2id),
        num_global_nodes=len(node2id) + 1,
        dropout=0.3,
        num_rels=len(rel2id),
        num_cats=len(cat2id),
        use_edge_types=USE_EDGE_TYPES,
    )
    model.load_state_dict(torch.load(weight_path, map_location="cpu"))
    model.eval()

    with torch.no_grad():
        emb = model(data)  # [N, hid]
        emb_np = emb.cpu().numpy()

    # All-pairs prediction scores, masked to self.
    scores = emb_np @ emb_np.T  # [N, N]
    np.fill_diagonal(scores, -np.inf)

    # Importance ranking: mean outgoing score across the graph.
    importance = np.mean(np.where(scores > -np.inf, scores, 0), axis=1)
    order = np.argsort(-importance)

    # Walk the ranking and pick the top-N *after* filtering junk types and
    # deduping near-alias pairs (TXN + Texas Instruments Inc etc). We
    # oversample because ~half the raw top rows are CONCEPT / bare numerals.
    n_total = len(nodes_list)
    top_entities: list[tuple[int, str, str]] = []  # (idx, name, normalised)
    seen_norm: set[str] = set()

    for i in order:
        if len(top_entities) >= TOP_ENTITIES_PER_PERIOD:
            break
        name = nodes_list[i]
        t = node_map.get(name, "UNK")
        if t not in RANKED_TYPES:
            continue
        if is_junk_entity(name):
            continue
        norm = normalise_name(name)
        if not norm or norm in seen_norm:
            continue
        seen_norm.add(norm)
        top_entities.append((i, name, norm))

    top_entity_names = [n for _, n, _ in top_entities]

    novelty = compute_novelty(df, period, top_entity_names)
    trend = compute_trend_3m(df, period, top_entity_names)

    # Top-K predicted impacted entities per source. Filter junk, dedupe
    # aliases against the source and against each other. Score is dropped
    # from the output — ordinal position carries the strength signal in the
    # UI and raw dot products aren't interpretable to end users.
    entries = []
    for rank_idx, (i, src_name, src_norm) in enumerate(top_entities, start=1):
        src_type = node_map.get(src_name, "UNK")

        row_scores = scores[i]
        candidate_order = np.argsort(-row_scores)

        impacted = []
        impacted_norms: set[str] = {src_norm}
        for j in candidate_order:
            if len(impacted) >= TOP_IMPACTED_PER_ENTITY:
                break
            tgt_name = nodes_list[j]
            tgt_type = node_map.get(tgt_name, "UNK")
            if tgt_type not in IMPACTED_TYPES:
                continue
            if is_junk_entity(tgt_name):
                continue
            tgt_norm = normalise_name(tgt_name)
            if not tgt_norm or tgt_norm in impacted_norms:
                continue
            impacted_norms.add(tgt_norm)
            impacted.append({"entity": tgt_name, "type": tgt_type})

        entries.append(
            {
                "rank": rank_idx,
                "entity": src_name,
                "entity_type": src_type,
                "novelty_z": round(novelty.get(src_name, 0.0), 3),
                "trend_3m": trend.get(src_name, [0, 0, 0]),
                "predicted_impacted": impacted,
            }
        )

    return {
        "period": period,
        "total_entities": n_total,
        "entries": entries,
    }


def main():
    global TRIPLETS_CSV, WEIGHTS_DIR, OUTPUT_PATH, STRATEGY, USE_EDGE_TYPES
    ap = argparse.ArgumentParser(
        description="FinDKG-style predictions JSON from GAT checkpoints"
    )
    ap.add_argument("--csv", type=Path, default=TRIPLETS_CSV)
    ap.add_argument("--weights-dir", type=Path, default=WEIGHTS_DIR)
    ap.add_argument("--out", type=Path, default=OUTPUT_PATH)
    ap.add_argument("--source-id", default=None,
                    help="Shortcut: write to frontend/public/data/sources/"
                    "<id>/predictions.json (overrides --out).")
    ap.add_argument("--strategy", default=STRATEGY)
    ap.add_argument("--model-label", default="CE (No Edge Feats)")
    ap.add_argument("--mrr", type=float, default=0.7746,
                    help="Headline MRR to display for this weight set.")
    ap.add_argument("--edge-types", action="store_true",
                    help="Load weights trained WITH edge features "
                    "(Rel+Cat+NormW configs). Must match the checkpoint.")
    ap.add_argument("--hits1", type=float, default=None,
                    help="Backtest Hits@1 to display alongside MRR.")
    ap.add_argument("--hits3", type=float, default=None)
    ap.add_argument("--hits10", type=float, default=None)
    args = ap.parse_args()
    TRIPLETS_CSV = args.csv.expanduser()
    WEIGHTS_DIR = args.weights_dir.expanduser()
    STRATEGY = args.strategy
    USE_EDGE_TYPES = args.edge_types
    OUTPUT_PATH = args.out
    if args.source_id:
        OUTPUT_PATH = (
            Path(__file__).resolve().parent.parent
            / "frontend" / "public" / "data" / "sources"
            / args.source_id / "predictions.json"
        )
    main.model_label = args.model_label
    main.mrr = args.mrr
    main.hits = {k: getattr(args, k) for k in ("hits1", "hits3", "hits10")
                 if getattr(args, k) is not None}

    print(f"Loading triplets from {TRIPLETS_CSV}")
    df = load_df_from_csv(TRIPLETS_CSV, strategy=STRATEGY)
    if df.empty:
        raise SystemExit("No triplets loaded.")

    df["period"] = pd.to_datetime(df["date"]).dt.to_period("M").astype(str)

    # Rebuild the same global maps the trainer used, in the same order.
    rel2id = build_rel_map(df)
    cat2id = build_rel_category_map(df)
    type2id = build_type_map(df)
    all_nodes = set(df["sub"].unique()) | set(df["obj"].unique())
    node2id = {n: i + 1 for i, n in enumerate(sorted(all_nodes))}
    id2type = {}  # reverse-lookup left empty; per-period node_map is authoritative

    periods = sorted(df["period"].unique())
    print(f"{len(periods)} periods: {periods[0]} → {periods[-1]}")

    results = {}
    for period in periods:
        if not (WEIGHTS_DIR / f"{period}.pt").exists():
            print(f"  {period}: no weights (skipping — first period, no prior window)")
            continue
        print(f"  {period}: computing…", end=" ", flush=True)
        entry = compute_period_predictions(
            period, df, rel2id, cat2id, type2id, node2id, id2type
        )
        if entry is None:
            print("skipped")
            continue
        results[period] = entry
        print(f"top-{len(entry['entries'])} of {entry['total_entities']}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(
            {
                "model": main.model_label,
                "strategy": STRATEGY,
                "mrr": main.mrr,
                **getattr(main, "hits", {}),
                "periods": results,
            },
            f,
            indent=2,
        )
    print(f"\nWrote {OUTPUT_PATH}  ({OUTPUT_PATH.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
