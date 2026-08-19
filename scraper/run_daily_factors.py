"""Daily runner — factor-model pipeline.

Wholly separate from run_daily.py (which the existing team pipeline uses
untouched). Reads scraper/watchlists/stoxx_600_factors.yaml by default,
fetches Google News, dedups against a SEPARATE ledger file so the two
pipelines never contend, runs enriched Gemini extraction (sentiment /
materiality / event_type per triplet), writes per-month KG snapshots +
per-day factor bundles under sources/<corpus>/.

Usage:
    python scraper/run_daily_factors.py
    python scraper/run_daily_factors.py --watchlist stoxx_600_factors --articles-per-ticker 3
    python scraper/run_daily_factors.py --slice 1/3     # process 1st third of the watchlist
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / "backend" / ".env")

from scraper.sources import google_news, rss_feeds  # noqa: E402
from scraper.sources.base import Article  # noqa: E402
from scraper.ledger import Ledger  # noqa: E402
from scraper.extraction_enriched import extract_enriched  # noqa: E402
from scraper.refinement import (  # noqa: E402
    canonicalize_entities,
    known_entity_names,
    refine_triplets,
)
from scraper.snapshots_factors import update_corpus_enriched  # noqa: E402


PUBLIC_DATA = REPO_ROOT / "frontend" / "public" / "data" / "sources"
WATCHLIST_DIR = REPO_ROOT / "scraper" / "watchlists"
# Distinct ledger file so the factor pipeline dedups independently of the
# team's existing pipeline — no cross-contamination on either side.
LEDGER_PATH = REPO_ROOT / "scraper" / "state" / "seen_urls_factors.json"

DEFAULT_ARTICLES_PER_TICKER = 3

# Reject articles whose pubDate is older than this — Google News RSS
# sometimes serves republished pieces dated years back, which would spawn
# junk single-article month buckets on the timeline.
MAX_ARTICLE_AGE_DAYS = 120


def _load_watchlist(name: str) -> dict:
    path = WATCHLIST_DIR / f"{name}.yaml"
    if not path.exists():
        raise SystemExit(f"Watchlist not found: {path}")
    with open(path) as f:
        return yaml.safe_load(f)


def _apply_slice(tickers: list[str], slice_arg: str | None) -> list[str]:
    """Return the requested slice of tickers, e.g. '1/3' → first third."""
    if not slice_arg:
        return tickers
    try:
        n_str, of_str = slice_arg.split("/")
        n, m = int(n_str), int(of_str)
        assert 1 <= n <= m
    except Exception:
        raise SystemExit(f"--slice expected format N/M (1-indexed); got: {slice_arg}")
    per = (len(tickers) + m - 1) // m
    start = (n - 1) * per
    return tickers[start : start + per]


def _fetch_for_watchlist(
    watchlist: dict,
    articles_per_ticker: int,
    ticker_subset: list[str] | None,
) -> list[Article]:
    """Fetch articles for every ticker in the watchlist using each configured
    source. Handles google_news + rss_feeds sources for now."""
    sources = watchlist.get("sources", ["google_news"])
    tickers = ticker_subset if ticker_subset is not None else watchlist.get("tickers", [])

    all_articles: list[Article] = []
    print(f"Fetching for {len(tickers)} tickers across sources {sources}…")

    if "google_news" in sources:
        for i, ticker in enumerate(tickers, start=1):
            try:
                arts = google_news.fetch(
                    ticker,
                    extra_terms="",
                    region="US",
                    lang="en",
                    limit=articles_per_ticker,
                )
                all_articles.extend(arts[:articles_per_ticker])
                if i % 5 == 0 or i == len(tickers):
                    print(f"  fetched {i}/{len(tickers)} tickers ({len(all_articles)} articles total)")
            except Exception as e:
                print(f"  {ticker:12s}  fetch failed: {e}")

    if "rss_feeds" in sources:
        for feed in watchlist.get("rss_feeds", []):
            try:
                arts = rss_feeds.fetch(feed["url"], feed.get("name", "rss"))
                all_articles.extend(arts)
            except Exception as e:
                print(f"  rss {feed.get('name','?')} failed: {e}")

    print(f"Fetched {len(all_articles)} articles total.\n")
    return all_articles


def main():
    parser = argparse.ArgumentParser(description="Daily factor-model scraper.")
    parser.add_argument(
        "--watchlist",
        default="stoxx_600_factors",
        help="Watchlist name (without .yaml) under scraper/watchlists/. Default: stoxx_600_factors.",
    )
    parser.add_argument(
        "--articles-per-ticker",
        type=int,
        default=DEFAULT_ARTICLES_PER_TICKER,
        help="Max articles to pull per ticker from Google News. Default 3.",
    )
    parser.add_argument(
        "--slice",
        default=None,
        help="Process only the N/M-th slice of tickers (1-indexed). Useful for chunked backfill.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run everything except the final Gemini extraction and disk writes. Useful for testing.",
    )
    parser.add_argument(
        "--factors-only",
        action="store_true",
        help="Skip fetch + extraction; recompute the factor bundle and index from snapshots already on disk (no API calls).",
    )
    args = parser.parse_args()

    watchlist = _load_watchlist(args.watchlist)
    corpus = watchlist.get("corpus", args.watchlist)
    tickers = _apply_slice(watchlist.get("tickers", []), args.slice)
    if not tickers:
        raise SystemExit(f"No tickers to process for watchlist {args.watchlist}")

    print(f"Corpus: {corpus}")
    print(f"Tickers (this run): {len(tickers)}  slice={args.slice or 'full'}")
    print(f"Articles per ticker: {args.articles_per_ticker}\n")

    # --factors-only: skip fetch/extraction entirely and recompute the
    # factor bundle (and index) from the snapshots already on disk. No
    # Gemini calls; useful for rebuilds and after data cleanups.
    if args.factors_only:
        corpus_root = PUBLIC_DATA / corpus
        summary = update_corpus_enriched(
            corpus_root=corpus_root,
            corpus_name=corpus,
            articles=[],
            triplets_by_url={},
        )
        print(f"\nSummary: {summary}")
        return

    # Fetch
    articles = _fetch_for_watchlist(watchlist, args.articles_per_ticker, tickers)
    if not articles:
        print("No articles fetched; exiting.")
        return

    # Google News RSS occasionally surfaces republished evergreen pieces
    # whose pubDate is years old. One such article creates a whole junk
    # month bucket (a 2-node snapshot in 2019) that pollutes the timeline,
    # so drop anything dated beyond the realistic RSS lookback before
    # spending Gemini calls on it.
    stale_cutoff = (date.today() - timedelta(days=MAX_ARTICLE_AGE_DAYS)).isoformat()
    dated = [a for a in articles if (a.date or "")[:10] >= stale_cutoff]
    if len(dated) < len(articles):
        print(f"Dropped {len(articles) - len(dated)} stale articles (older than {MAX_ARTICLE_AGE_DAYS} days).")
    articles = dated

    # Dedup
    ledger = Ledger(LEDGER_PATH)
    fresh = [a for a in articles if not ledger.contains(a.url)]
    print(f"Dedup: {len(articles)} fetched → {len(fresh)} new (skipped {len(articles) - len(fresh)} already-seen).\n")

    if not fresh:
        print("Nothing new to process. Exiting cleanly.")
        return

    if args.dry_run:
        print("--dry-run set; skipping extraction and writes.")
        return

    # Enriched extraction
    print(f"Extracting triplets from {len(fresh)} new articles…")
    triplets_by_url = extract_enriched(fresh)
    total_triplets = sum(len(v) for v in triplets_by_url.values())
    print(f"\nExtracted {total_triplets} triplets across {len(fresh)} articles.\n")

    # Second + third LLM passes (mirrors the team pipeline's judge +
    # flagged-triplet refiner): per-article judge-and-refine, then one
    # cross-article entity canonicalization call. Both fail open.
    print("Refining triplets (judge + refine pass)…")
    triplets_by_url = refine_triplets(fresh, triplets_by_url)
    print("Canonicalizing entities across articles…")
    triplets_by_url = canonicalize_entities(
        triplets_by_url, known_entity_names(PUBLIC_DATA / corpus)
    )
    refined_total = sum(len(v) for v in triplets_by_url.values())
    print(f"After refinement: {refined_total} triplets "
          f"({total_triplets - refined_total:+d} vs first pass).\n")

    # Mark ledger
    for a in fresh:
        ledger.add(a.url)
    ledger.save()

    # Write snapshots + factors under sources/<corpus>/. The factor bundle
    # is computed inside from the last months of stored snapshots (rolling
    # corpus), not from today's delta — see snapshots_factors.
    corpus_root = PUBLIC_DATA / corpus
    summary = update_corpus_enriched(
        corpus_root=corpus_root,
        corpus_name=corpus,
        articles=fresh,
        triplets_by_url=triplets_by_url,
    )
    print(f"\nSummary: {summary}")


if __name__ == "__main__":
    main()
