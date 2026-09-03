"""NOTEARS causal node features — port of the Spring 2026 team's method.

The NOTEARS implementation and the 5-dim feature extraction below are
taken from the Spring 2026 deliverable (causal_files/: ckg_notears.py,
ckg_causal.py — Xixi Chen, Xinyi Chen, Yi Yang), inlined here with their
config constants so the current pipeline can train a causally augmented
GAT without modifying team code. Reference: Zheng et al., "DAGs with NO
TEARS", NeurIPS 2018.

Method (unchanged from Spring 2026):
  1. Per training window, build a (days x entities) co-occurrence matrix
     over the top-200 most frequent entities (top-k fixed globally across
     windows for stability).
  2. Learn a DAG with NOTEARS (pure numpy augmented Lagrangian).
  3. Per entity: [out-degree, in-degree, out-weight-sum, in-weight-sum,
     PageRank] on that DAG, max-normalised; zeros for entities outside
     the top-k.
  4. Append the 5 dims to the model's node features.

Integration: `install(gat_module, full_df)` monkeypatches the team
trainer's `build_graph_from_df` (to remember which dataframe produced
which graph) and `build_node_features` (to append the causal dims
computed from that dataframe). Team files stay untouched.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import networkx as nx
import numpy as np
import pandas as pd
from scipy.optimize import minimize

# Spring 2026 config constants (ckg_config.py), inlined.
CAUSAL_DIM = 5
NOTEARS_THRESHOLD = 0.1
NOTEARS_MAX_ITER = 20
MAX_DAG_ENTITIES = 200


# ── NOTEARS (ckg_notears.py, verbatim) ────────────────────────────────────

def _h(W: np.ndarray) -> float:
    d = W.shape[0]
    M = W * W
    eigvals = np.linalg.eigvalsh(M)
    eigvals = np.clip(eigvals, -500, 500)
    return float(np.sum(np.exp(eigvals)) - d)


def _h_grad(W: np.ndarray) -> np.ndarray:
    d = W.shape[0]
    M = W * W
    M_clipped = np.clip(M, -10, 10)
    E = np.linalg.matrix_power(np.eye(d) + M_clipped / d, d - 1)
    return E.T * W * 2


def notears_linear(
    X: np.ndarray,
    lambda1: float = 0.1,
    max_iter: int = 20,
    w_threshold: float = 0.1,
    h_tol: float = 1e-6,
    rho_max: float = 1e8,
) -> np.ndarray:
    n, d = X.shape
    W = np.zeros((d, d), dtype=np.float64)
    rho, alpha, h = 1.0, 0.0, np.inf

    def _aug_lagrangian(w_flat):
        W_ = w_flat.reshape(d, d)
        R = X - X @ W_
        loss = 0.5 / n * (R * R).sum()
        g_ls = -1.0 / n * X.T @ R
        h_ = _h(W_)
        h_g = _h_grad(W_)
        obj = loss + (alpha + 0.5 * rho * h_) * h_
        grad = g_ls + (alpha + rho * h_) * h_g
        return obj, grad.flatten()

    for _ in range(max_iter):
        res = minimize(_aug_lagrangian, W.flatten(),
                       method="L-BFGS-B", jac=True,
                       options={"maxiter": 100, "ftol": 1e-8})
        W_new = res.x.reshape(d, d)
        W_new = np.sign(W_new) * np.maximum(np.abs(W_new) - lambda1 / rho, 0)
        np.fill_diagonal(W_new, 0)
        h_new = _h(W_new)
        alpha += rho * h_new
        W = W_new
        h = h_new
        if h <= h_tol:
            break
        rho = min(rho * 5, rho_max)

    W[np.abs(W) < w_threshold] = 0
    np.fill_diagonal(W, 0)
    return W


def notears_to_dag(W: np.ndarray, entity_list: list) -> nx.DiGraph:
    dag = nx.DiGraph()
    for name in entity_list:
        dag.add_node(name)
    d = W.shape[0]
    for i in range(d):
        for j in range(d):
            if i != j and W[i, j] != 0:
                dag.add_edge(entity_list[i], entity_list[j],
                             weight=float(W[i, j]))
    return dag


# ── Causal features (ckg_causal.py, verbatim modulo config import) ────────

def _top_entities(flat_df: pd.DataFrame, entity_list: List[str],
                  k: int = MAX_DAG_ENTITIES) -> List[str]:
    counts = pd.concat([flat_df["sub"], flat_df["obj"]]).value_counts()
    counts = counts[counts.index.isin(set(entity_list))]
    return counts.head(k).index.tolist()


def _build_cooccurrence(flat_df: pd.DataFrame,
                        entity_list: List[str]) -> np.ndarray:
    e2i = {e: i for i, e in enumerate(entity_list)}
    n = len(entity_list)
    daily = flat_df.groupby(flat_df["date"].dt.date)
    days = sorted(daily.groups.keys())
    if not days:
        return np.zeros((1, n), dtype=np.float32)
    X = np.zeros((len(days), n), dtype=np.float32)
    for row, day in enumerate(days):
        ddf = daily.get_group(day)
        for ent in pd.concat([ddf["sub"], ddf["obj"]]).unique():
            if ent in e2i:
                X[row, e2i[ent]] += 1.0
    row_max = X.max(axis=1, keepdims=True)
    row_max[row_max == 0] = 1.0
    return X / row_max


def _learn_dag(X: np.ndarray, entity_list: List[str]) -> nx.DiGraph:
    if X.shape[1] < 2 or X.shape[0] < 2:
        return nx.DiGraph()
    W = notears_linear(
        X.astype(np.float64),
        lambda1=NOTEARS_THRESHOLD,
        max_iter=NOTEARS_MAX_ITER,
        w_threshold=NOTEARS_THRESHOLD,
    )
    return notears_to_dag(W, entity_list)


def _dag_to_features(dag: nx.DiGraph,
                     entity_list: List[str]) -> Dict[str, np.ndarray]:
    zero = np.zeros(CAUSAL_DIM, dtype=np.float32)
    if dag.number_of_nodes() == 0:
        return {e: zero.copy() for e in entity_list}
    dag_nodes = set(dag.nodes())
    out_deg = dict(dag.out_degree())
    in_deg = dict(dag.in_degree())
    max_deg = max(max(out_deg.values(), default=1),
                  max(in_deg.values(), default=1), 1)
    out_w = {n: 0.0 for n in dag_nodes}
    in_w = {n: 0.0 for n in dag_nodes}
    for u, v, d in dag.edges(data=True):
        w = abs(d.get("weight", 1.0))
        out_w[u] = out_w.get(u, 0.0) + w
        in_w[v] = in_w.get(v, 0.0) + w
    max_ow = max(out_w.values(), default=1.0) or 1.0
    max_iw = max(in_w.values(), default=1.0) or 1.0
    try:
        pr = nx.pagerank(dag, alpha=0.85, max_iter=200)
    except Exception:
        pr = {n: 1.0 / len(dag_nodes) for n in dag_nodes}
    max_pr = max(pr.values(), default=1.0) or 1.0
    out: Dict[str, np.ndarray] = {}
    for e in entity_list:
        if e not in dag_nodes:
            out[e] = zero.copy()
            continue
        vec = np.zeros(CAUSAL_DIM, dtype=np.float32)
        vec[0] = out_deg.get(e, 0) / max_deg
        vec[1] = in_deg.get(e, 0) / max_deg
        vec[2] = out_w.get(e, 0.0) / max_ow
        vec[3] = in_w.get(e, 0.0) / max_iw
        vec[4] = pr.get(e, 0.0) / max_pr
        out[e] = vec
    return out


def compute_causal_features(
    flat_df: pd.DataFrame,
    entity_list: List[str],
    global_top_entities: Optional[List[str]] = None,
    fallback_on_error: bool = True,
) -> Dict[str, np.ndarray]:
    zero_feats = {e: np.zeros(CAUSAL_DIM, dtype=np.float32)
                  for e in entity_list}
    if flat_df.empty or not entity_list:
        return zero_feats
    try:
        top_ents = (global_top_entities if global_top_entities is not None
                    else _top_entities(flat_df, entity_list))
        if len(top_ents) < 2:
            return zero_feats
        X = _build_cooccurrence(flat_df, top_ents)
        dag = _learn_dag(X, top_ents)
        top_features = _dag_to_features(dag, top_ents)
        result = dict(zero_feats)
        result.update(top_features)
        return result
    except Exception as exc:
        if fallback_on_error:
            print(f"[causal_features] WARNING: {exc} — zero features used.")
            return zero_feats
        raise


# ── Integration with the team trainer ─────────────────────────────────────

def install(gat_module, full_df: pd.DataFrame) -> None:
    """Monkeypatch the team trainer so every node-feature matrix gains the
    5 causal dims, computed from the same dataframe that produced the
    graph. The global top-200 is fixed from the full corpus, as in the
    Spring 2026 run_and_save."""
    all_entities = sorted(set(full_df["sub"]) | set(full_df["obj"]))
    global_top = _top_entities(full_df, all_entities)
    df_for_graph: Dict[int, pd.DataFrame] = {}

    orig_build_graph = gat_module.build_graph_from_df
    orig_build_feats = gat_module.build_node_features

    def build_graph_wrapped(df, *args, **kwargs):
        G = orig_build_graph(df, *args, **kwargs)
        df_for_graph[id(G)] = df
        return G

    def build_feats_wrapped(G, node_map, type2id, *args, **kwargs):
        X, nodes_list, type_ids = orig_build_feats(
            G, node_map, type2id, *args, **kwargs)
        df = df_for_graph.get(id(G))
        if df is None:
            causal = {n: np.zeros(CAUSAL_DIM, dtype=np.float32)
                      for n in nodes_list}
        else:
            causal = compute_causal_features(
                df, list(nodes_list), global_top_entities=global_top)
        F = np.stack([
            causal.get(n, np.zeros(CAUSAL_DIM, dtype=np.float32))
            for n in nodes_list
        ])
        X_aug = np.hstack([np.asarray(X, dtype=np.float32), F])
        return X_aug, nodes_list, type_ids

    gat_module.build_graph_from_df = build_graph_wrapped
    gat_module.build_node_features = build_feats_wrapped
    print(f"[causal_features] installed: +{CAUSAL_DIM} dims, "
          f"global top-{len(global_top)} entities")
