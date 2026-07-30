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

import json
import sys
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
import torch

# Pierre's fork provides the model + feature builders. Add it to sys.path so
# imports resolve regardless of where this script is invoked from.
EIB_EVAL_ROOT = Path("/Users/alexandrapaiz/Desktop/eib-eval/eib")
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

TOP_ENTITIES_PER_PERIOD = 20
TOP_IMPACTED_PER_ENTITY = 5

# Which entity types count as "financial" for the "Predicted Most Impacted
# Financial Entities" column. Same set drives the label list — anything else
# is dropped from the impacted list, but still allowed as a source entity.
FINANCIAL_TYPES = {
    "COMPANY",
    "STOCKTICKER",
    "STOCK_TICKER",
    "FINANCIALENTITY",
    "FINANCIAL_ENTITY",
    "MACROINDICATOR",
    "MACRO_INDICATOR",
    "ECONINDICATOR",
    "ECON_INDICATOR",
    "FININSTRUMENTINFO",
    "FIN_INSTRUMENT_INFO",
    "BOND",
    "CURRENCY",
    "DERIVATIVE",
    "SECTOR",
}


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

    # Importance ranking: mean outgoing score (rewards nodes whose embedding
    # predicts many strong links across the graph, without being dominated by
    # a single outlier target).
    importance = np.mean(np.where(scores > -np.inf, scores, 0), axis=1)
    order = np.argsort(-importance)

    # Top-N by importance
    top_n_idx = order[:TOP_ENTITIES_PER_PERIOD]
    top_entities = [nodes_list[i] for i in top_n_idx]

    novelty = compute_novelty(df, period, top_entities)
    trend = compute_trend_3m(df, period, top_entities)

    # Rank percentile within the period. Rank 1 → 100%, last → ~0%.
    n_total = len(nodes_list)
    rank_percentile = {}
    for rank, i in enumerate(order):
        rank_percentile[nodes_list[i]] = round(
            100.0 * (n_total - rank) / n_total, 1
        )

    # Top-K predicted impacted financial entities per source entity.
    entries = []
    for i in top_n_idx:
        src_name = nodes_list[i]
        src_type = node_map.get(src_name, "UNK")

        row_scores = scores[i]
        candidate_order = np.argsort(-row_scores)

        impacted = []
        for j in candidate_order:
            if len(impacted) >= TOP_IMPACTED_PER_ENTITY:
                break
            tgt_name = nodes_list[j]
            tgt_type = node_map.get(tgt_name, "UNK")
            if tgt_type not in FINANCIAL_TYPES:
                continue
            impacted.append(
                {
                    "entity": tgt_name,
                    "type": tgt_type,
                    "score": round(float(row_scores[j]), 4),
                }
            )

        entries.append(
            {
                "entity": src_name,
                "entity_type": src_type,
                "rank_percentile": rank_percentile[src_name],
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
                "model": "CE (No Edge Feats)",
                "strategy": STRATEGY,
                "mrr": 0.7746,
                "periods": results,
            },
            f,
            indent=2,
        )
    print(f"\nWrote {OUTPUT_PATH}  ({OUTPUT_PATH.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
