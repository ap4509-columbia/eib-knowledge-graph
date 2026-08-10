"""Local factor-model preview — no UI, no commit, no touching production.

For a small hand-picked cross-section of STOXX 600 tickers, this:
  1. Fetches the 3 freshest Google News snippets per ticker
  2. Runs enriched triplet extraction (adds sentiment, materiality, event_type)
  3. Rolls up per-entity factor scores (6 factors: attention / momentum / sentiment /
     consensus / novelty / materiality)
  4. Runs PCA to get 2D projection + variance explained
  5. Runs KMeans to find archetype clusters
  6. Prints a table of entities × factors + cluster label, and the PCA loadings

Run it as:  python3 scripts/factor_model_preview.py
Cost: ~$0.007 (72 Gemini calls at ~$0.0001 each).
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / "backend" / ".env")

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from scraper.sources import google_news
from google import genai
import os


# ── Config ────────────────────────────────────────────────────────────────
ARTICLES_PER_TICKER = 3

# 24 tickers × 6 sectors — chosen for size + news-frequency + geographic spread.
# Ticker suffixes match the STOXX 600 watchlist (.PA / .DE / .SW / .L / .MC etc).
CROSS_SECTION = [
    # Pharma
    ("NOVO-B.CO", "Novo Nordisk",  "Pharma"),
    ("ROG.SW",    "Roche",         "Pharma"),
    ("NOVN.SW",   "Novartis",      "Pharma"),
    ("SAN.PA",    "Sanofi",        "Pharma"),
    # Tech
    ("SAP.DE",    "SAP",           "Tech"),
    ("ASML.AS",   "ASML",          "Tech"),
    ("ADYEN.AS",  "Adyen",         "Tech"),
    ("CAP.PA",    "Capgemini",     "Tech"),
    # Banks
    ("BNP.PA",    "BNP Paribas",   "Banks"),
    ("HSBA.L",    "HSBC",          "Banks"),
    ("SAN.MC",    "Santander",     "Banks"),
    ("DBK.DE",    "Deutsche Bank", "Banks"),
    # Industrials
    ("SIE.DE",    "Siemens",       "Industrials"),
    ("AIR.PA",    "Airbus",        "Industrials"),
    ("SU.PA",     "Schneider",     "Industrials"),
    ("VOW3.DE",   "Volkswagen",    "Industrials"),
    # Energy
    ("SHEL.L",    "Shell",         "Energy"),
    ("TTE.PA",    "TotalEnergies", "Energy"),
    ("BP.L",      "BP",            "Energy"),
    ("EQNR.OL",   "Equinor",       "Energy"),
    # Consumer
    ("NESN.SW",   "Nestlé",        "Consumer"),
    ("MC.PA",     "LVMH",          "Consumer"),
    ("ULVR.L",    "Unilever",      "Consumer"),
    ("ITX.MC",    "Inditex",       "Consumer"),
]

PROMPT_PATH = REPO_ROOT / "scraper" / "prompts" / "triplet_extraction_enriched.txt"


# ── Extraction ────────────────────────────────────────────────────────────
def extract_enriched(text: str, client: genai.Client) -> list[dict]:
    """Run the enriched extractor on one article's text; return a list of
    triplet-dicts (may be empty). Guards against malformed model output."""
    prompt = PROMPT_PATH.read_text().replace("{input_text_}", text)
    try:
        resp = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        raw = (resp.text or "").strip()
    except Exception as e:
        print(f"    (Gemini error: {e})")
        return []

    # Strip markdown fences if present
    raw = re.sub(r"^```json\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return []
        return [t for t in parsed if isinstance(t, dict) and "sub" in t and "obj" in t]
    except Exception:
        return []


# ── Factor rollup ─────────────────────────────────────────────────────────
def entity_factors(triplets: list[dict], ticker_names: set[str]) -> dict[str, dict]:
    """Roll up triplets into per-entity factor scores.

    Factors here are FIRST-PASS operational proxies, computable from a single
    corpus snapshot with no historical baseline. They're not the final versions
    (ATTENTION would z-score against a 90-day mean once we have history) but
    they should still discriminate entities in a small sample.
    """
    # Per-entity accumulators
    subj_articles: dict[str, set[str]] = defaultdict(set)   # ATTENTION proxy
    subj_sentiments: dict[str, list[float]] = defaultdict(list)
    subj_materialities: dict[str, list[float]] = defaultdict(list)
    subj_event_types: dict[str, list[str]] = defaultdict(list)
    subj_partners: dict[str, set[str]] = defaultdict(set)

    # (article_key, subj) -> best sentiment (dedup per-article multiple triplets)
    article_subj_sentiments: dict[tuple[str, str], float] = {}

    for t in triplets:
        subj = t.get("sub")
        obj = t.get("obj")
        art_key = t.get("_article_key", "")
        if not subj:
            continue

        subj_articles[subj].add(art_key)
        if obj:
            subj_partners[subj].add(obj)

        s = t.get("sentiment")
        if isinstance(s, (int, float)):
            subj_sentiments[subj].append(float(s))
            article_subj_sentiments[(art_key, subj)] = float(s)

        m = t.get("materiality_usd")
        if isinstance(m, (int, float)) and m > 0:
            subj_materialities[subj].append(float(m))

        ev = t.get("event_type")
        if isinstance(ev, str):
            subj_event_types[subj].append(ev)

    factors = {}
    all_entities = set(subj_articles.keys())
    for e in all_entities:
        n_articles = len(subj_articles[e])

        # 1. ATTENTION — raw article count. In a real pipeline this z-scores
        #    against the 90-day baseline; for the preview we use raw counts.
        attention = float(n_articles)

        # 2. MOMENTUM — undefined in a single snapshot (no time series). Placeholder.
        momentum = 0.0

        # 3. SENTIMENT — mean sentiment across all triplets where entity is subject.
        sentiments = subj_sentiments[e]
        sentiment = float(np.mean(sentiments)) if sentiments else 0.0

        # 4. CONSENSUS — 1 - std of per-article sentiment. Single article → 1.0.
        art_sents = [
            v for (a, s), v in article_subj_sentiments.items() if s == e
        ]
        if len(art_sents) < 2:
            consensus = 1.0
        else:
            consensus = float(max(0.0, 1.0 - np.std(art_sents)))

        # 5. NOVELTY proxy — fraction of partners this entity uniquely brought in
        #    (partners that appear only linked to this entity in our sample).
        partners = subj_partners[e]
        if not partners:
            novelty = 0.0
        else:
            unique_partners = 0
            for p in partners:
                # p appears in subj_partners for anyone else?
                others_with_p = sum(1 for k, v in subj_partners.items() if k != e and p in v)
                if others_with_p == 0:
                    unique_partners += 1
            novelty = unique_partners / len(partners)

        # 6. MATERIALITY — log-scaled sum of extracted dollar magnitudes.
        mag_sum = sum(subj_materialities[e]) if subj_materialities[e] else 0.0
        materiality = float(np.log1p(mag_sum))

        # Event diversity (kept as diagnostic — not one of the 6 factors, but
        # useful when inspecting a cluster).
        event_diversity = len(set(subj_event_types[e])) if subj_event_types[e] else 0

        factors[e] = {
            "attention": attention,
            "momentum": momentum,
            "sentiment": sentiment,
            "consensus": consensus,
            "novelty": novelty,
            "materiality": materiality,
            "_diag_event_diversity": event_diversity,
            "_diag_n_articles": n_articles,
            "_diag_event_mix": Counter(subj_event_types[e]).most_common(3),
        }
    return factors


# ── Main ──────────────────────────────────────────────────────────────────
def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY not set (put it in backend/.env)")
    client = genai.Client(api_key=api_key)

    print(f"Fetching {ARTICLES_PER_TICKER} articles for each of {len(CROSS_SECTION)} tickers…\n")

    all_triplets: list[dict] = []
    ticker_lookup: dict[str, tuple[str, str]] = {}  # entity_name → (ticker, sector)

    for ticker, name, sector in CROSS_SECTION:
        ticker_lookup[name] = (ticker, sector)
        ticker_lookup[ticker] = (ticker, sector)

        arts = google_news.fetch(ticker, extra_terms=name, region="US", lang="en",
                                 limit=ARTICLES_PER_TICKER)
        if not arts:
            print(f"  {ticker:12s} {name:16s}  (no articles)")
            continue

        n_triplets = 0
        for i, art in enumerate(arts[:ARTICLES_PER_TICKER]):
            key = f"{ticker}_{i}"
            triplets = extract_enriched(art.text or art.title, client)
            for t in triplets:
                t["_article_key"] = key
                t["_seed_ticker"] = ticker
                all_triplets.append(t)
            n_triplets += len(triplets)
        print(f"  {ticker:12s} {name:16s}  {len(arts)} arts → {n_triplets} triplets")

    print(f"\nTotal: {len(all_triplets)} triplets across {len(CROSS_SECTION)} tickers.\n")

    # Roll up factor scores per entity
    factors = entity_factors(all_triplets, set(t for t, _, _ in CROSS_SECTION))

    # Keep only entities present in enough articles to be meaningful for
    # clustering — filters out singleton mentions that would dominate noise.
    factors = {e: v for e, v in factors.items() if v["_diag_n_articles"] >= 2}
    print(f"{len(factors)} entities with ≥2 article mentions (used for factor analysis).\n")

    if len(factors) < 5:
        print("Too few entities to meaningfully cluster. Try increasing ARTICLES_PER_TICKER.")
        return

    # Build the matrix
    FACTOR_COLS = ["attention", "momentum", "sentiment", "consensus", "novelty", "materiality"]
    entities = sorted(factors.keys())
    X = np.array([[factors[e][c] for c in FACTOR_COLS] for e in entities], dtype=float)

    # Drop MOMENTUM (all zeros in a single snapshot — no variance = no info)
    keep_cols = [i for i, c in enumerate(FACTOR_COLS) if X[:, i].std() > 1e-9]
    kept_names = [FACTOR_COLS[i] for i in keep_cols]
    X = X[:, keep_cols]
    print(f"Kept factors (nonzero variance): {kept_names}\n")

    # Standardise
    X_scaled = StandardScaler().fit_transform(X)

    # PCA
    n_pc = min(3, X_scaled.shape[1])
    pca = PCA(n_components=n_pc)
    coords = pca.fit_transform(X_scaled)
    print("=" * 78)
    print("PCA")
    print("=" * 78)
    print(f"Explained variance: {[f'{v:.1%}' for v in pca.explained_variance_ratio_]}")
    print(f"Cumulative:         {[f'{v:.1%}' for v in np.cumsum(pca.explained_variance_ratio_)]}\n")
    print("Component loadings (which raw factors drive each PC):")
    for i in range(n_pc):
        loadings = list(zip(kept_names, pca.components_[i]))
        loadings.sort(key=lambda x: -abs(x[1]))
        parts = [f"{name}={coef:+.2f}" for name, coef in loadings]
        print(f"  PC{i+1}: " + "  ".join(parts))
    print()

    # KMeans — pick k=4 as a sensible starting point
    k = min(5, max(2, len(entities) // 4))
    km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(X_scaled)
    labels = km.labels_

    # Report
    print("=" * 78)
    print(f"KMeans (k={k})")
    print("=" * 78)
    for cluster_id in range(k):
        members = [entities[i] for i in range(len(entities)) if labels[i] == cluster_id]
        centroid = km.cluster_centers_[cluster_id]
        dominant = [(kept_names[i], centroid[i]) for i in range(len(kept_names))]
        dominant.sort(key=lambda x: -abs(x[1]))
        signature = ", ".join(f"{n}{'+' if v > 0 else '-'}" for n, v in dominant[:3])
        print(f"\nCluster {cluster_id}  [{signature}]  — {len(members)} entities")
        for e in members[:20]:
            f = factors[e]
            print(f"  {e:35s} att={f['attention']:.0f}  sent={f['sentiment']:+.2f}  "
                  f"nov={f['novelty']:.2f}  mat={f['materiality']:.1f}  "
                  f"[{f['_diag_n_articles']} arts, "
                  f"events={' '.join(f'{k}:{v}' for k, v in f['_diag_event_mix'])}]")

    # Also dump the full loading matrix for inspection
    print("\n" + "=" * 78)
    print("Full loading table")
    print("=" * 78)
    header = f"{'ENTITY':<36}" + "".join(f"  {n[:9]:>9s}" for n in kept_names) + "   PC1     PC2  CLUSTER"
    print(header)
    print("-" * len(header))
    for i, e in enumerate(entities):
        row = f"{e[:36]:<36}"
        for j, c in enumerate(kept_names):
            row += f"  {X[i, j]:>9.2f}"
        row += f"  {coords[i, 0]:>+5.2f}  {coords[i, 1]:>+5.2f}    {labels[i]}"
        print(row)

    # Save artifacts to disk so the UI wire-up later can consume them
    out_dir = REPO_ROOT / "scripts" / "factor_preview_output"
    out_dir.mkdir(parents=True, exist_ok=True)
    output = {
        "factors_used": kept_names,
        "entities": [
            {
                "name": e,
                "factors": {c: factors[e][c] for c in FACTOR_COLS},
                "pc1": float(coords[i, 0]),
                "pc2": float(coords[i, 1]) if n_pc > 1 else 0.0,
                "cluster": int(labels[i]),
                "n_articles": factors[e]["_diag_n_articles"],
                "event_mix": factors[e]["_diag_event_mix"],
            }
            for i, e in enumerate(entities)
        ],
        "pca_explained_variance": pca.explained_variance_ratio_.tolist(),
        "pca_components": pca.components_.tolist(),
        "kmeans_k": k,
        "kmeans_centroids": km.cluster_centers_.tolist(),
    }
    with open(out_dir / "factors.json", "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\nSaved factor artifacts to {out_dir}/factors.json")


if __name__ == "__main__":
    main()
