"""Retroactive cleanup of a corpus's month snapshots.

The STOXX corpus accumulated weeks of first-pass extraction before the
judge/refine/canonicalization stages existed (added 2026-08-20), and
snapshots are immutable merges — so junk entities and name variants from
that era persist in the graph and leak into everything downstream
(factors, GAT, predictions). This script cleans the stored snapshots in
place:

  1. Junk-entity removal — bare numbers/amounts, quarter boilerplate,
     generic finance phrases that make no sense as graph nodes
  2. Canonical merging — same TF-IDF + union-find machinery as
     canonicalize_corpus (same-type only, shared-word anchor, numeric
     guard); edges rewrite onto canonical names, weights sum
  3. Degree recompute + node prune (nodes with no surviving edges drop)

Run downstream refreshers afterwards (factors --factors-only, GAT,
predictions).

    python3 -m scripts.clean_snapshots \
        --corpus frontend/public/data/sources/stoxx_600_factors
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from scripts.canonicalize_corpus import build_entity_canonical_map

JUNK_PATTERNS = [
    re.compile(r"^\d+([.,]\d+)?$"),
    re.compile(r"^\d+([.,]\d+)?\s*(k|m|b|bn|billion|million|trillion)?\s*(usd|eur|gbp|dkk|chf|sek|dollars?|euros?)?$", re.I),
    re.compile(r"^Q[1-4]\b", re.I),
    re.compile(r"^(First|Second|Third|Fourth|Next)\s?Quarter\b", re.I),
    re.compile(r"^(H[12]|FY\d{2,4})\b", re.I),
    re.compile(r"^\d+(\.\d+)?%"),
    re.compile(r"^\d{4}$"),
]

GENERIC_BLOCKLIST = {
    "profit", "outlook", "revenue", "revenue growth", "earnings", "eps",
    "guidance", "potential upside", "share price", "stock price",
    "a share price crash", "share buybacks", "buyback", "dividend",
    "h1 results", "q2 results", "results", "sales", "growth",
    "pipeline growth", "market", "shares", "stock", "investors",
    "valuation", "upside", "downside", "trading", "performance",
}


def is_junk(name: str) -> bool:
    n = name.strip()
    if len(n) < 2:
        return True
    if n.lower() in GENERIC_BLOCKLIST:
        return True
    return any(p.match(n) for p in JUNK_PATTERNS)


# Legal/corporate suffixes that never distinguish two real-world entities.
# "Apple" vs "Apple Inc." sits below any safe TF-IDF threshold (short name,
# big relative suffix), so these merge deterministically instead.
CORP_SUFFIX = re.compile(
    r"(,?\s+(inc|incorporated|corp|corporation|company|co|ltd|limited"
    r"|p\.?l\.?c|holdings?|group|n\.?v|s\.?a|a\/s|ag|se|shares?|stock"
    r"|[ab]))+\.?$",
    re.I,
)
# "Merck & Co.", "JPMorgan Chase & Co." — the ampersand blocks CORP_SUFFIX
# (which requires the suffix to follow plain whitespace), so it gets its
# own pass. "Tiffany & Co" the brand loses nothing by keying to "tiffany".
_AMP_CO = re.compile(r"\s*(?:&|and)\s+co(?:mpany)?\.?$", re.I)
# "Walt Disney Company (The)" — index-style inverted article.
_THE_TRAIL = re.compile(r"\s*\(the\)$", re.I)


def _suffix_key(name: str) -> str:
    """Case-folded name with trailing corporate suffixes stripped, plus
    article/punctuation normalization so "Bristol-Myers Squibb" and
    "Bristol Myers Squibb Co" collapse to one key."""
    n = name.strip().rstrip(".")
    n = _THE_TRAIL.sub("", n)
    n = re.sub(r"^the\s+", "", n, flags=re.I)
    n = _AMP_CO.sub("", n)
    n = CORP_SUFFIX.sub("", n)
    n = n.lower().strip()
    n = re.sub(r"[-‐-―]", " ", n)  # hyphens/dashes -> space
    return re.sub(r"\s+", " ", n)


_TICKER_TYPES = {"STOCK_TICKER", "STOCKTICKER", "TICKER", "STOCK TICKER"}
_EXCH_SUFFIX = re.compile(r"\.[A-Z]{1,3}$")


def build_ticker_alias_map(
    watchlist: str, freq: Counter, type_of: dict[str, str]
) -> dict[str, str]:
    """Merge ticker-symbol nodes into their company node using the
    watchlist's `companies:` map. Handles decorated forms: AZN.L, LSE:AZN,
    AAPL:NASDAQ, plain AZN. Cores shorter than 3 chars (V, MA, MS…) only
    merge when the node is actually typed as a ticker, so abbreviations
    of other things can't be swallowed."""
    import yaml

    path = Path(__file__).resolve().parent.parent / "scraper" / "watchlists" / f"{watchlist}.yaml"
    companies = (yaml.safe_load(path.read_text()) or {}).get("companies") or {}
    alias: dict[str, str] = {}
    for tick, comp in companies.items():
        t = str(tick).upper()
        core = _EXCH_SUFFIX.sub("", t)
        for k in {t, core, re.sub(r"[-\s]", "", core)}:
            alias.setdefault(k, comp)

    mapping: dict[str, str] = {}
    for name in freq:
        u = name.upper().strip()
        # Length guard only — the alias lookup itself is the filter, and
        # decorated forms like "CPSE:NOVO B" legitimately contain spaces.
        if len(u) > 16 or u != name.strip():
            # lowercase letters => prose-like name, not a ticker symbol
            continue
        cands = {u}
        if ":" in u:
            a, b = u.split(":", 1)
            cands |= {a, b}
        cands |= {_EXCH_SUFFIX.sub("", c) for c in set(cands)}
        cands |= {re.sub(r"[-\s]", "", c) for c in set(cands)}
        for c in sorted(cands, key=len, reverse=True):
            comp = alias.get(c)
            if comp is None or name == comp:
                continue
            if len(c) < 3 and type_of.get(name, "UNK") not in _TICKER_TYPES:
                continue
            mapping[name] = comp
            break
    return mapping


def build_suffix_canonical_map(
    freq: Counter, type_of: dict[str, str]
) -> dict[str, str]:
    """Deterministic merges: same suffix-stripped, case-folded name.
    Canonical = the most frequent variant. Catches Apple/Apple Inc. and
    52-Week High/52-week High without any similarity guesswork.

    Type guard, relaxed: extractors type the bare name and the suffixed
    name inconsistently ("Walmart" Company vs "Walmart Inc." ORGANIZATION),
    so requiring identical types fragments exactly the firms we most want
    whole. Members whose raw name differs from the key (a suffix, hyphen,
    or article was normalized away) merge across types — the difference is
    itself the evidence they're the same firm. Only when every member is
    the key verbatim (pure case variants of an ambiguous word) do we still
    split by type."""
    groups: dict[str, list[str]] = defaultdict(list)
    for name in freq:
        key = _suffix_key(name)
        if len(key) < 3:
            continue  # too short to trust after stripping
        groups[key].append(name)
    mapping: dict[str, str] = {}
    for key, members in groups.items():
        if len(members) < 2:
            continue
        normalized_away = any(m.strip().lower() != key for m in members)
        if not normalized_away:
            by_type: dict[str, list[str]] = defaultdict(list)
            for m in members:
                by_type[type_of.get(m, "UNK")].append(m)
            for ms in by_type.values():
                if len(ms) < 2:
                    continue
                canonical = max(ms, key=lambda m: freq[m])
                for m in ms:
                    if m != canonical:
                        mapping[m] = canonical
            continue
        canonical = max(members, key=lambda m: freq[m])
        for m in members:
            if m != canonical:
                mapping[m] = canonical

    # Cross-type exception: "X Shares" / "X Stock" merges into a node
    # named X whatever its type — like tickers, these are the firm under
    # a different hat, and splitting them fragments the graph.
    by_name = {n.strip().lower(): n for n in freq}
    shares_re = re.compile(r"^(.+?)\s+(shares?|stock)$", re.I)
    for name in freq:
        if name in mapping:
            continue
        m = shares_re.match(name.strip())
        if m:
            base = by_name.get(m.group(1).strip().lower())
            if base and base != name:
                mapping[name] = mapping.get(base, base)
    return mapping


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--sim", type=float, default=0.9)
    ap.add_argument("--watchlist", default=None,
                    help="Watchlist name whose companies: map merges ticker "
                    "nodes (AZN.L, LSE:AZN) into their company node.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    snap_paths = sorted((args.corpus / "snapshots").glob("*.json"))
    snaps = {p: json.loads(p.read_text()) for p in snap_paths}

    # Corpus-wide entity stats for the canonical map
    freq: Counter = Counter()
    types: dict[str, Counter] = defaultdict(Counter)
    for snap in snaps.values():
        for n in snap.get("nodes", []):
            freq[n["id"]] += max(1, int(n.get("degree") or 1))
            types[n["id"]][n.get("type", "UNK")] += 1
    type_of = {e: c.most_common(1)[0][0] for e, c in types.items()}

    junk = {e for e in freq if is_junk(e)}
    keep_freq = Counter({e: c for e, c in freq.items() if e not in junk})

    # Pass 0: ticker symbols -> company nodes (watchlist-driven).
    # Pass 1: deterministic suffix/case merges. Pass 2: fuzzy TF-IDF on the
    # survivors. Composed so a variant chained through several passes lands
    # on the final canonical name.
    ticker_map = (
        build_ticker_alias_map(args.watchlist, keep_freq, type_of)
        if args.watchlist
        else {}
    )
    t_freq = Counter()
    for e, c in keep_freq.items():
        t_freq[ticker_map.get(e, e)] += c
    suffix_map = build_suffix_canonical_map(t_freq, type_of)
    merged_freq = Counter()
    for e, c in t_freq.items():
        merged_freq[suffix_map.get(e, e)] += c
    fuzzy_map = build_entity_canonical_map(merged_freq, type_of, args.sim)
    mapping: dict[str, str] = {}
    for e in keep_freq:
        step = ticker_map.get(e, e)
        step = suffix_map.get(step, step)
        final = fuzzy_map.get(step, step)
        if final != e:
            mapping[e] = final
    print(f"{len(freq)} entities · {len(junk)} junk removed · "
          f"{len(mapping)} variants merged "
          f"({len(ticker_map)} ticker->company, "
          f"{len(suffix_map)} suffix/case, "
          f"{len(fuzzy_map)} fuzzy; e.g. {list(mapping.items())[:3]})")

    total_dropped_edges = total_merged = 0
    for p, snap in snaps.items():
        edge_map: dict[str, dict] = {}
        dropped = 0
        for e in snap.get("edges", []):
            s = e.get("source", "")
            t = e.get("target", "")
            if s in junk or t in junk:
                dropped += 1
                continue
            s = mapping.get(s, s)
            t = mapping.get(t, t)
            if s == t:
                dropped += 1
                continue
            eid = f"{s}||{e.get('rel','')}||{t}"
            if eid in edge_map:
                ex = edge_map[eid]
                ex["weight"] = (ex.get("weight") or 1) + (e.get("weight") or 1)
                total_merged += 1
            else:
                e = dict(e)
                e["id"] = eid
                e["source"] = s
                e["target"] = t
                edge_map[eid] = e
        edges = list(edge_map.values())

        degree: Counter = Counter()
        for e in edges:
            w = e.get("weight") or 1
            degree[e["source"]] += w
            degree[e["target"]] += w

        # Nodes already bearing their canonical name go first, so a merged
        # node keeps the company's attributes (type, position) rather than
        # inheriting them from whichever ticker variant happened to come
        # first in the file.
        pos = {n["id"]: n for n in sorted(
            snap.get("nodes", []),
            key=lambda n: mapping.get(n["id"], n["id"]) != n["id"],
        )}
        nodes = []
        seen: set[str] = set()
        for old_id, n in pos.items():
            new_id = mapping.get(old_id, old_id)
            if old_id in junk or new_id in seen or new_id not in degree:
                continue
            seen.add(new_id)
            m = dict(n)
            m["id"] = new_id
            m["degree"] = int(degree[new_id])
            nodes.append(m)

        snap["nodes"] = nodes
        snap["edges"] = edges
        if "stats" in snap:
            snap["stats"]["nodes"] = len(nodes)
            snap["stats"]["edges"] = len(edges)
        total_dropped_edges += dropped
        print(f"  {p.stem}: {len(nodes)} nodes, {len(edges)} edges "
              f"({dropped} junk/self edges dropped)")
        if not args.dry_run:
            p.write_text(json.dumps(snap, indent=2))

    print(f"Done. {total_dropped_edges} edges dropped, {total_merged} merged"
          + (" (dry run — nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
