"""Corpus-level canonicalization — the bottom row of the Fall 2025 pipeline
flowchart, reimplemented (the Spring 2025 code never made it into the
current team repo).

Takes the article-level pipeline's judged CSVs (post Judge + third-LLM
refinement) and applies, across the WHOLE corpus:

  1. Corpus aggregation           — all chunks into one table
  2. Frequency-based filtering    — drop entities seen < min-freq times
  3. TF-IDF + cosine clustering   — char+word n-grams so partial overlaps
                                    ("ASML" / "ASML Holding N.V.") match
  4. Union-find canonical mapping — clusters collapse to their most
                                    frequent member's name; only same-type
                                    entities merge (tickers never merge
                                    into companies)
  5. Relation label consolidation — near-identical labels (fuzzy ≥ 92)
                                    collapse to the most frequent variant
  6. Global duplicate removal     — dedupe identical triplets per article

Output: one combined CSV whose `output_triplets` column holds the
canonical triplets — ready for both the UI publisher and gat.py.

    python -m scripts.canonicalize_corpus \
        --csv chunk_A_Judge...csv --csv chunk_B_Judge...csv \
        --out canonical_corpus.csv \
        [--triplets-column "Revised triplets"] [--min-freq 2] [--sim 0.88]
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors


def parse_triplets(raw) -> list[tuple]:
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return []
    out = []
    for t in parsed if isinstance(parsed, (list, tuple)) else []:
        if isinstance(t, (list, tuple)) and len(t) == 6:
            out.append(tuple(str(x).strip() for x in t))
    return out


class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def build_entity_canonical_map(
    entity_freq: Counter,
    entity_type: dict[str, str],
    sim_threshold: float,
) -> dict[str, str]:
    """TF-IDF + cosine neighbour search + union-find, same-type merges only."""
    names = sorted(entity_freq.keys())
    if len(names) < 2:
        return {}
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
    X = vec.fit_transform(names)
    nn = NearestNeighbors(metric="cosine", radius=1 - sim_threshold)
    nn.fit(X)
    dist, idx = nn.radius_neighbors(X, return_distance=True)

    uf = UnionFind(len(names))
    for i, (drow, irow) in enumerate(zip(dist, idx)):
        for d, j in zip(drow, irow):
            if j <= i:
                continue
            a, b = names[i], names[j]
            if entity_type.get(a) != entity_type.get(b):
                continue
            # Require a shared word-level anchor so "Novo Nordisk" doesn't
            # merge with "Novartis" on character-gram similarity alone.
            wa = {w.lower() for w in a.split() if len(w) > 2}
            wb = {w.lower() for w in b.split() if len(w) > 2}
            if wa and wb and not (wa & wb):
                continue
            # Numerically distinct names ("10 nm Process" vs "7 nm
            # Process", "Q3 Revenue" vs "Q4 Revenue") are different
            # entities no matter how similar the text is.
            import re as _re
            if _re.findall(r"\d+", a) != _re.findall(r"\d+", b):
                continue
            uf.union(i, j)

    clusters: dict[int, list[str]] = defaultdict(list)
    for i, name in enumerate(names):
        clusters[uf.find(i)].append(name)

    mapping: dict[str, str] = {}
    for members in clusters.values():
        if len(members) < 2:
            continue
        canonical = max(members, key=lambda m: (entity_freq[m], len(m)))
        for m in members:
            if m != canonical:
                mapping[m] = canonical
    return mapping


def build_relation_canonical_map(rel_freq: Counter) -> dict[str, str]:
    """Collapse case/spacing variants and near-identical labels."""
    try:
        from thefuzz import fuzz
    except ImportError:
        fuzz = None
    by_lower: dict[str, list[str]] = defaultdict(list)
    for r in rel_freq:
        by_lower[r.lower().strip()].append(r)
    mapping: dict[str, str] = {}
    lowers = sorted(by_lower.keys())
    canonical_of_lower: dict[str, str] = {
        lo: max(vs, key=lambda v: rel_freq[v]) for lo, vs in by_lower.items()
    }
    # exact case-insensitive collapse
    for lo, variants in by_lower.items():
        canon = canonical_of_lower[lo]
        for v in variants:
            if v != canon:
                mapping[v] = canon
    # fuzzy collapse between distinct lowercase labels
    if fuzz is not None:
        reps = sorted(canonical_of_lower.values(), key=lambda r: -rel_freq[r])
        merged: dict[str, str] = {}
        for i, a in enumerate(reps):
            if a in merged:
                continue
            for b in reps[i + 1 :]:
                if b in merged:
                    continue
                if fuzz.ratio(a.lower(), b.lower()) >= 92:
                    merged[b] = a
        mapping.update(merged)
    return mapping


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--csv", action="append", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--triplets-column", default="Revised triplets")
    ap.add_argument("--min-freq", type=int, default=2,
                    help="Drop entities seen fewer than this many times "
                    "corpus-wide (triplets touching them are removed).")
    ap.add_argument("--sim", type=float, default=0.88,
                    help="Cosine similarity threshold for entity merging.")
    ap.add_argument("--strict", action="store_true",
                    help="Strict graph construction (Fall 2025's winning "
                    "strategy): keep refined triplet lists and rows whose "
                    "evaluation met expectations; DROP rows flagged for "
                    "human review or errored, instead of falling back to "
                    "the first pass. Use for GAT training input.")
    args = ap.parse_args()

    # 1. Corpus aggregation
    frames = []
    for p in args.csv:
        try:
            frames.append(pd.read_csv(p))
        except pd.errors.ParserError:
            frames.append(pd.read_csv(p, engine="python", on_bad_lines="skip"))
    df = pd.concat(frames, ignore_index=True)
    if "url" in df.columns:
        df = df.drop_duplicates(subset="url", keep="first")

    def row_triplets(row) -> list[tuple]:
        rev_raw = row.get(args.triplets_column)
        trips = parse_triplets(rev_raw)
        if trips:
            return trips
        if args.strict:
            # Mirror data_utils strict mode: an unrevised row survives only
            # if its evaluation explicitly met expectations.
            if "evaluation meets expectation" in str(rev_raw or "").lower():
                return parse_triplets(row.get("output_triplets"))
            return []
        return parse_triplets(row.get("output_triplets"))

    all_trips = [row_triplets(r) for _, r in df.iterrows()]
    entity_freq: Counter = Counter()
    entity_types: dict[str, Counter] = defaultdict(Counter)
    rel_freq: Counter = Counter()
    for trips in all_trips:
        for sub, st, rel, cat, obj, ot in trips:
            entity_freq[sub] += 1
            entity_freq[obj] += 1
            entity_types[sub][st] += 1
            entity_types[obj][ot] += 1
            rel_freq[rel] += 1
    entity_type = {e: c.most_common(1)[0][0] for e, c in entity_types.items()}
    print(f"Aggregated {len(df)} articles, {sum(map(len, all_trips))} triplets, "
          f"{len(entity_freq)} unique entities, {len(rel_freq)} unique relations")

    # 3+4. Canonical entity mapping
    ent_map = build_entity_canonical_map(entity_freq, entity_type, args.sim)
    print(f"Entity canonicalization: {len(ent_map)} variants merged, e.g. "
          + "; ".join(f"{k!r}→{v!r}" for k, v in list(ent_map.items())[:4]))

    # 5. Relation consolidation
    rel_map = build_relation_canonical_map(rel_freq)
    print(f"Relation consolidation: {len(rel_map)} labels collapsed")

    # Recompute frequency on canonical names for the frequency filter
    canon_freq: Counter = Counter()
    for trips in all_trips:
        for sub, st, rel, cat, obj, ot in trips:
            canon_freq[ent_map.get(sub, sub)] += 1
            canon_freq[ent_map.get(obj, obj)] += 1

    # 2+6. Rewrite, frequency-filter, global dedupe
    kept = dropped_freq = dropped_dupe = 0
    out_col = []
    for trips in all_trips:
        seen: set[tuple] = set()
        out_trips = []
        for sub, st, rel, cat, obj, ot in trips:
            sub_c = ent_map.get(sub, sub)
            obj_c = ent_map.get(obj, obj)
            rel_c = rel_map.get(rel, rel)
            if sub_c == obj_c:
                continue
            if canon_freq[sub_c] < args.min_freq or canon_freq[obj_c] < args.min_freq:
                dropped_freq += 1
                continue
            key = (sub_c, rel_c, obj_c)
            if key in seen:
                dropped_dupe += 1
                continue
            seen.add(key)
            out_trips.append((sub_c, entity_type.get(sub_c, st), rel_c, cat,
                              obj_c, entity_type.get(obj_c, ot)))
            kept += 1
        out_col.append(repr(out_trips))

    df = df.copy()
    df["output_triplets"] = out_col
    if args.triplets_column in df.columns and args.triplets_column != "output_triplets":
        df = df.drop(columns=[args.triplets_column])
    df.to_csv(args.out, index=False)
    print(f"Wrote {args.out}: {kept} canonical triplets kept "
          f"({dropped_freq} dropped by min-freq {args.min_freq}, "
          f"{dropped_dupe} exact duplicates removed)")


if __name__ == "__main__":
    main()
