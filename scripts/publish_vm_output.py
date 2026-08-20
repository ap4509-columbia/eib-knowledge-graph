"""Publish the team's VM pipeline output (eib-eval triplet CSVs) to the UI.

The eib-eval pipeline writes CSVs with one row per article:
    date, title, ticker, url, text, summary, output_triplets
where output_triplets is a Python-literal list of 6-tuples:
    (sub, sub_type, rel, rel_cat, obj, obj_type)

This script converts those rows into the frontend's static data layout
(month snapshots + articles + raw triplets under
frontend/public/data/sources/<source-id>/) using the same writer the live
STOXX pipeline uses, then optionally commits + pushes — which triggers the
Vercel deploy. Run it on the VM (or anywhere) after the pipeline finishes:

    python -m scripts.publish_vm_output \
        --csv /path/to/triplets_gemini-2.5-flash_...csv \
        --source-id fnspid-19-20-semis \
        --replace --push

Flags:
    --csv        input CSV (repeatable for several files)
    --source-id  target source under frontend/public/data/sources/
    --replace    overwrite each month's snapshot instead of merging into
                 it. USE THIS when re-publishing a CSV that was already
                 published — merging the same rows twice doubles edge
                 weights.
    --push       git add/commit/push the updated data (requires the repo
                 to have push credentials — a deploy key on the VM)
    --dry-run    parse + report, write nothing

See docs/VM_PUBLISHING.md for the one-time VM setup.
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import pandas as pd  # noqa: E402

from scraper.sources.base import Article  # noqa: E402
from scraper.snapshots_factors import update_corpus_enriched  # noqa: E402

PUBLIC_DATA = REPO_ROOT / "frontend" / "public" / "data" / "sources"


def _parse_triplets(raw) -> list[dict]:
    """VM 6-tuples → the enriched dict schema the snapshot writer expects.

    The VM pipeline doesn't produce sentiment/materiality/event_type, so
    those get neutral defaults — the graph renders fine without them; only
    the factor tab (which FNSPID doesn't enable) would care."""
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return []
    out = []
    for t in parsed if isinstance(parsed, (list, tuple)) else []:
        if not (isinstance(t, (list, tuple)) and len(t) == 6):
            continue
        sub, sub_type, rel, rel_cat, obj, obj_type = (str(x) for x in t)
        if not sub or not obj or sub == obj:
            continue
        out.append(
            {
                "sub": sub,
                "sub_type": sub_type or "UNK",
                "rel": rel or "Related To",
                "rel_category": rel_cat or "UNK",
                "obj": obj,
                "obj_type": obj_type or "UNK",
                "sentiment": 0.0,
                "materiality_usd": None,
                "event_type": "OTHER",
            }
        )
    return out


def load_csvs(
    paths: list[Path],
    triplets_column: str = "output_triplets",
) -> tuple[list[Article], dict[str, list[dict]]]:
    articles: list[Article] = []
    triplets_by_url: dict[str, list[dict]] = {}
    seen_urls: set[str] = set()
    for p in paths:
        try:
            df = pd.read_csv(p)
        except pd.errors.ParserError:
            # Big VM outputs sometimes carry rows whose article text breaks
            # the quoting. Re-parse with the tolerant python engine and drop
            # the malformed rows rather than failing the whole publish.
            df = pd.read_csv(p, engine="python", on_bad_lines="skip")
            print(f"{p.name}: malformed rows skipped (tolerant parse)")
        missing = {"date", "url", triplets_column} - set(df.columns)
        if missing:
            raise SystemExit(f"{p}: missing expected columns {sorted(missing)}")
        for _, row in df.iterrows():
            url = str(row.get("url") or "").strip()
            date = str(row.get("date") or "")[:10]
            if not url or len(date) != 10 or url in seen_urls:
                continue
            trips = _parse_triplets(row.get(triplets_column))
            if not trips and triplets_column != "output_triplets":
                # Judged CSVs put sentinel strings ("Require Human Review",
                # "Error: ...") in the revised column for ambiguous rows —
                # the metrics disagreed, not that the triplets are bad.
                # Fall back to the first-pass triplets instead of dropping
                # the article.
                trips = _parse_triplets(row.get("output_triplets"))
            if not trips:
                continue
            seen_urls.add(url)
            articles.append(
                Article(
                    date=date,
                    title=str(row.get("title") or "").strip(),
                    ticker=str(row.get("ticker") or "").strip(),
                    url=url,
                    source="vm-pipeline",
                    text=str(row.get("summary") or row.get("text") or "")[:1000],
                )
            )
            triplets_by_url[url] = trips
    return articles, triplets_by_url


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--csv", action="append", required=True, type=Path)
    ap.add_argument("--source-id", default="fnspid-19-20-semis")
    ap.add_argument(
        "--triplets-column",
        default="output_triplets",
        help="CSV column holding the triplet list. Use 'Revised triplets' "
        "on JudgeLLM metrics_computation outputs to publish the "
        "third-LLM-refined triplets instead of the raw first pass.",
    )
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    articles, triplets_by_url = load_csvs(args.csv, args.triplets_column)
    by_month: dict[str, int] = defaultdict(int)
    for a in articles:
        by_month[a.date[:7]] += 1
    total_trips = sum(len(v) for v in triplets_by_url.values())
    print(f"Parsed {len(articles)} articles / {total_trips} triplets "
          f"across months: {dict(sorted(by_month.items()))}")

    if args.dry_run:
        print("--dry-run: nothing written.")
        return

    corpus_root = PUBLIC_DATA / args.source_id
    if args.replace:
        # Remove the affected months' snapshot files so the writer starts
        # them fresh instead of merging (which would double weights on a
        # re-publish). Articles/triplets files dedupe by URL so they're
        # safe either way.
        for month in by_month:
            snap = corpus_root / "snapshots" / f"{month}.json"
            if snap.exists():
                snap.unlink()
                print(f"--replace: cleared snapshot {month}")

    summary = update_corpus_enriched(
        corpus_root=corpus_root,
        corpus_name=args.source_id,
        articles=articles,
        triplets_by_url=triplets_by_url,
    )
    print(f"Summary: {summary}")

    if args.push:
        rel = corpus_root.relative_to(REPO_ROOT)
        cmds = [
            ["git", "add", str(rel)],
            ["git", "commit", "-m", f"data: VM pipeline publish → {args.source_id}"],
            ["git", "pull", "--rebase", "origin", "main"],
            ["git", "push", "origin", "main"],
        ]
        for cmd in cmds:
            print("+", " ".join(cmd))
            r = subprocess.run(cmd, cwd=REPO_ROOT)
            if r.returncode != 0:
                raise SystemExit(f"command failed: {' '.join(cmd)}")
        print("Pushed — Vercel will redeploy with the new data.")


if __name__ == "__main__":
    main()
