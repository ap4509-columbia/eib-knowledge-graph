"""Factor computation + PCA + KMeans over a batch of enriched triplets.

Given the day's freshly extracted triplet-dicts (from extraction_enriched),
produce per-entity factor loadings and cluster assignments, then serialise
to a JSON shape the frontend Factor Analysis tab can render directly.

Design notes:
  * Factors chosen for a one-day snapshot (no historical baseline required):
      ATTENTION    — number of articles the entity appears in as subject
      SENTIMENT    — mean sentiment across triplets where entity is subject
      CONSENSUS    — 1 − stdev of per-article sentiment (single-source → 1.0)
      NOVELTY      — fraction of counterparties unique to this entity in the sample
      MATERIALITY  — log-scaled sum of extracted USD magnitudes
  * MOMENTUM is intentionally omitted at the daily-snapshot level; it needs
    week-over-week attention deltas and will land in a follow-up (Phase 3).
  * PCA is only used for the 2D visualisation; clustering happens in the raw
    (standardised) factor space so no information is lost.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Optional

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


FACTOR_COLS = ["attention", "sentiment", "consensus", "novelty", "materiality"]


def compute_entity_factors(triplets_by_url: dict[str, list[dict]]) -> dict[str, dict]:
    """Roll up enriched triplets into per-entity factor scores.

    Each triplet-dict is expected to carry: sub, sub_type, rel, obj, obj_type,
    sentiment (float), materiality_usd (float|None), event_type (str).
    """
    subj_articles: dict[str, set[str]] = defaultdict(set)
    subj_sentiments: dict[str, list[float]] = defaultdict(list)
    subj_materialities: dict[str, list[float]] = defaultdict(list)
    subj_event_types: dict[str, list[str]] = defaultdict(list)
    subj_partners: dict[str, set[str]] = defaultdict(set)
    # (article_url, subj) → sentiment observation, used for the per-article
    # sentiment dispersion in the CONSENSUS factor.
    article_subj_sent: dict[tuple[str, str], float] = {}
    subj_type_map: dict[str, str] = {}

    for url, triplets in triplets_by_url.items():
        for t in triplets:
            subj = t.get("sub")
            obj = t.get("obj")
            if not subj:
                continue
            subj_articles[subj].add(url)
            subj_type_map.setdefault(subj, t.get("sub_type", "UNK"))
            if obj:
                subj_partners[subj].add(obj)
                subj_type_map.setdefault(obj, t.get("obj_type", "UNK"))

            s = t.get("sentiment", 0.0)
            if isinstance(s, (int, float)):
                subj_sentiments[subj].append(float(s))
                # Multiple triplets from the same article roll into the mean
                # for that (article, subject) pair.
                key = (url, subj)
                if key in article_subj_sent:
                    article_subj_sent[key] = (article_subj_sent[key] + float(s)) / 2
                else:
                    article_subj_sent[key] = float(s)

            m = t.get("materiality_usd")
            if isinstance(m, (int, float)) and m > 0:
                subj_materialities[subj].append(float(m))

            ev = t.get("event_type")
            if isinstance(ev, str):
                subj_event_types[subj].append(ev)

    # Second pass: for each entity, count how many of its partners are truly
    # unique to it (partner appears with no other subject in this sample).
    # Used for the NOVELTY factor.
    partner_subject_count: dict[str, int] = defaultdict(int)
    for subj, partners in subj_partners.items():
        for p in partners:
            partner_subject_count[p] += 1

    entities = sorted(subj_articles.keys())
    out: dict[str, dict] = {}

    for e in entities:
        n_articles = len(subj_articles[e])
        sentiments = subj_sentiments[e]
        sentiment = float(np.mean(sentiments)) if sentiments else 0.0

        art_sents = [
            v for (u, s), v in article_subj_sent.items() if s == e
        ]
        if len(art_sents) < 2:
            consensus = 1.0
        else:
            consensus = float(max(0.0, 1.0 - np.std(art_sents)))

        partners = subj_partners[e]
        if not partners:
            novelty = 0.0
        else:
            unique_partners = sum(1 for p in partners if partner_subject_count[p] == 1)
            novelty = unique_partners / len(partners)

        mag_sum = sum(subj_materialities[e]) if subj_materialities[e] else 0.0
        materiality = float(np.log1p(mag_sum))

        out[e] = {
            "type": subj_type_map.get(e, "UNK"),
            "n_articles": n_articles,
            "attention": float(n_articles),
            "sentiment": sentiment,
            "consensus": consensus,
            "novelty": novelty,
            "materiality": materiality,
            "event_mix": Counter(subj_event_types[e]).most_common(5),
            "top_partners": sorted(partners)[:10],
        }
    return out


def compute_entity_factors_from_snapshots(snapshots: list[dict]) -> dict[str, dict]:
    """Roll up per-entity factor scores from stored month snapshots.

    The daily runner originally computed factors from that day's freshly
    extracted triplets only — after the URL ledger warmed up, a day's delta
    was a handful of articles and every bundle came out empty. Month
    snapshots accumulate the whole corpus on disk, so rolling up from the
    latest snapshots gives the factor model a real sample every day.

    Snapshot edges are aggregated (one edge per unique sub|rel|obj with a
    `weight` = number of supporting extractions), so article-level
    granularity is approximated:
      ATTENTION   — total weight of edges where the entity is the subject
      SENTIMENT   — weight-weighted mean of edge sentiments
      CONSENSUS   — 1 − stdev of per-edge sentiment (≥2 edges, else 1.0)
      NOVELTY     — fraction of the entity's partners unique to it
      MATERIALITY — log1p of summed edge materiality_usd
    Output shape matches compute_entity_factors, so run_pca_kmeans consumes
    it unchanged (`n_articles` carries the attention weight for the
    min_articles threshold).
    """
    subj_weight: dict[str, float] = defaultdict(float)
    subj_sentiments: dict[str, list[tuple[float, float]]] = defaultdict(list)  # (sent, weight)
    subj_materialities: dict[str, list[float]] = defaultdict(list)
    subj_event_types: dict[str, list[str]] = defaultdict(list)
    subj_partners: dict[str, set[str]] = defaultdict(set)
    type_map: dict[str, str] = {}

    for snap in snapshots:
        for n in snap.get("nodes", []):
            type_map.setdefault(n.get("id", ""), n.get("type", "UNK"))
        for e in snap.get("edges", []):
            subj = e.get("source")
            obj = e.get("target")
            if not subj:
                continue
            w = float(e.get("weight") or 1)
            subj_weight[subj] += w
            if obj:
                subj_partners[subj].add(obj)

            s = e.get("sentiment")
            if isinstance(s, (int, float)):
                subj_sentiments[subj].append((float(s), w))

            m = e.get("materiality_usd")
            if isinstance(m, (int, float)) and m > 0:
                subj_materialities[subj].append(float(m))

            ev = e.get("event_type")
            if isinstance(ev, str):
                subj_event_types[subj].extend([ev] * int(w))

    partner_subject_count: dict[str, int] = defaultdict(int)
    for subj, partners in subj_partners.items():
        for p in partners:
            partner_subject_count[p] += 1

    out: dict[str, dict] = {}
    for e in sorted(subj_weight.keys()):
        sents = subj_sentiments[e]
        if sents:
            total_w = sum(w for _, w in sents)
            sentiment = float(sum(s * w for s, w in sents) / total_w)
        else:
            sentiment = 0.0

        if len(sents) < 2:
            consensus = 1.0
        else:
            consensus = float(max(0.0, 1.0 - np.std([s for s, _ in sents])))

        partners = subj_partners[e]
        if not partners:
            novelty = 0.0
        else:
            unique_partners = sum(1 for p in partners if partner_subject_count[p] == 1)
            novelty = unique_partners / len(partners)

        mag_sum = sum(subj_materialities[e]) if subj_materialities[e] else 0.0
        attention = subj_weight[e]
        out[e] = {
            "type": type_map.get(e, "UNK"),
            "n_articles": int(round(attention)),
            "attention": float(attention),
            "sentiment": sentiment,
            "consensus": consensus,
            "novelty": novelty,
            "materiality": float(np.log1p(mag_sum)),
            "event_mix": Counter(subj_event_types[e]).most_common(5),
            "top_partners": sorted(partners)[:10],
        }
    return out


def run_pca_kmeans(
    factors: dict[str, dict],
    min_articles: int = 2,
    k: Optional[int] = None,
) -> dict:
    """Take the per-entity factor scores, run PCA (for the 2D view) and
    KMeans (for cluster assignments), and return a bundle ready to JSON-dump.

    Entities with fewer than `min_articles` mentions are excluded — they
    contribute too little signal and would dominate noise.
    """
    keep_entities = [e for e, v in factors.items() if v["n_articles"] >= min_articles]
    if len(keep_entities) < 4:
        return {
            "generated_at": None,
            "min_articles": min_articles,
            "kept_factors": FACTOR_COLS,
            "entities": [],
            "pca": {"explained_variance": [], "components": []},
            "kmeans": {"k": 0, "centroids": []},
            "note": f"Only {len(keep_entities)} entities met the min_articles={min_articles} threshold.",
        }

    entities = sorted(keep_entities)
    X = np.array(
        [[factors[e][c] for c in FACTOR_COLS] for e in entities], dtype=float
    )

    # Drop zero-variance columns (would break StandardScaler / PCA)
    var_mask = X.std(axis=0) > 1e-9
    kept_cols = [c for c, keep in zip(FACTOR_COLS, var_mask) if keep]
    if not kept_cols:
        return {
            "generated_at": None,
            "min_articles": min_articles,
            "kept_factors": [],
            "entities": [],
            "pca": {"explained_variance": [], "components": []},
            "kmeans": {"k": 0, "centroids": []},
            "note": "All factor columns collapsed to zero variance.",
        }
    X = X[:, var_mask]

    X_scaled = StandardScaler().fit_transform(X)

    # PCA (2-3 comps, whichever fits)
    n_pc = min(3, X_scaled.shape[1])
    pca = PCA(n_components=n_pc)
    coords = pca.fit_transform(X_scaled)

    # KMeans — heuristic k if not given
    if k is None:
        k = min(5, max(2, len(entities) // 4))
    km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(X_scaled)
    labels = km.labels_.tolist()

    entity_records = []
    for i, e in enumerate(entities):
        f = factors[e]
        entity_records.append(
            {
                "name": e,
                "type": f["type"],
                "cluster": int(labels[i]),
                "pc1": float(coords[i, 0]),
                "pc2": float(coords[i, 1]) if n_pc > 1 else 0.0,
                "pc3": float(coords[i, 2]) if n_pc > 2 else 0.0,
                "factors": {
                    c: float(v) for c, v in zip(FACTOR_COLS, [factors[e][c] for c in FACTOR_COLS])
                },
                "n_articles": int(f["n_articles"]),
                "event_mix": f["event_mix"],
                "top_partners": f["top_partners"],
            }
        )

    # Cluster signatures — top-3 driving factors per centroid
    centroid_signatures = []
    for cid in range(k):
        centroid = km.cluster_centers_[cid]
        pairs = list(zip(kept_cols, centroid))
        pairs.sort(key=lambda x: -abs(x[1]))
        signature = [{"factor": n, "loading": float(v)} for n, v in pairs[:3]]
        member_names = [entities[i] for i in range(len(entities)) if labels[i] == cid]
        centroid_signatures.append(
            {
                "cluster": cid,
                "size": len(member_names),
                "signature": signature,
                "members": member_names,
            }
        )

    return {
        "generated_at": None,  # caller fills in
        "min_articles": min_articles,
        "kept_factors": kept_cols,
        "entities": entity_records,
        "pca": {
            "explained_variance": pca.explained_variance_ratio_.tolist(),
            "components": pca.components_.tolist(),  # shape (n_pc, len(kept_cols))
        },
        "kmeans": {
            "k": k,
            "centroids": km.cluster_centers_.tolist(),
            "clusters": centroid_signatures,
        },
    }
