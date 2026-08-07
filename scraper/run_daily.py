"""Main scraper entry point. Runs every day via GitHub Actions.

For each watchlist (YAML in scraper/watchlists/):
  1. Fetch fresh news from every configured source
  2. Deduplicate against scraper/state/seen_urls.json
  3. Send genuinely-new articles to Gemini for triplet extraction
  4. Merge results into frontend/public/data/{corpus}/ snapshot JSONs
  5. Update the ledger

Designed to be idempotent, tolerant of source failures, and safe to run
concurrently with the existing static snapshots (writes to a per-corpus
subdirectory).

Usage:
    python scraper/run_daily.py             # process every watchlist
    python scraper/run_daily.py us_semis    # only one corpus
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent

# Load GEMINI_API_KEY from backend/.env for local runs; GitHub Actions injects it via env.
load_dotenv(REPO_ROOT / "backend" / ".env")

# Local imports — must come after path setup so scraper/ is on sys.path
sys.path.insert(0, str(REPO_ROOT))

from scraper.sources import google_news, yahoo_finance, rss_feeds  # noqa: E402
from scraper.sources.base import Article  # noqa: E402
from scraper.ledger import Ledger  # noqa: E402
from scraper.extraction import extract_triplets  # noqa: E402
from scraper.snapshots import update_corpus, refresh_corpora_manifest  # noqa: E402


SCRAPER_DIR = REPO_ROOT / "scraper"
WATCHLIST_DIR = SCRAPER_DIR / "watchlists"
LEDGER_PATH = SCRAPER_DIR / "state" / "seen_urls.json"
# Per-corpus data now lives under /data/sources/{id}/ — one subdirectory
# per source-id, matching the front-end's data-source dropdown. The
# corpus name from each watchlist YAML doubles as the source id.
PUBLIC_DATA = REPO_ROOT / "frontend" / "public" / "data" / "sources"


SOURCE_MODULES = {
    "google_news": google_news,
    "yahoo_finance": yahoo_finance,
    "rss_feeds": rss_feeds,
}


def _fetch_for_watchlist(wl: dict) -> list[Article]:
    """Pull articles from every source × ticker combo in the watchlist."""
    articles: list[Article] = []
    sources = wl.get("sources", [])
    tickers = wl.get("tickers", [])

    for source_name in sources:
        mod = SOURCE_MODULES.get(source_name)
        if mod is None:
            print(f"  [!] unknown source '{source_name}' — skipping")
            continue

        if source_name == "rss_feeds":
            for feed_url in wl.get("rss_feeds", []):
                try:
                    articles += mod.fetch(feed_url)
                except Exception as exc:  # noqa: BLE001
                    print(f"  [!] {source_name} failed on {feed_url}: {exc}")
        else:
            for ticker in tickers:
                try:
                    articles += mod.fetch(ticker)
                except Exception as exc:  # noqa: BLE001
                    print(f"  [!] {source_name} failed on {ticker}: {exc}")

        # Extra Google News queries (language + freeform terms)
        extra = wl.get("extra_google_queries")
        if extra and source_name == "google_news":
            for term in extra.get("terms", []):
                try:
                    articles += mod.fetch(
                        ticker=term,
                        extra_terms="",
                        region=extra.get("region", "US"),
                        lang=extra.get("lang", "en"),
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"  [!] google_news failed on '{term}': {exc}")

    return articles


def _process_watchlist(path: Path, ledger: Ledger) -> dict | None:
    wl = yaml.safe_load(path.read_text())
    corpus = wl["corpus"]
    print(f"\n── corpus: {corpus} " + "─" * (60 - len(corpus)))

    all_articles = _fetch_for_watchlist(wl)
    print(f"  fetched {len(all_articles)} raw articles")

    # Dedup against ledger
    fresh = [a for a in all_articles if not ledger.contains(a.url)]
    # Also dedup within this batch (same url from multiple sources)
    seen_this_run: set[str] = set()
    unique_fresh: list[Article] = []
    for a in fresh:
        if a.url in seen_this_run:
            continue
        seen_this_run.add(a.url)
        unique_fresh.append(a)

    print(f"  {len(unique_fresh)} new after dedup")
    if not unique_fresh:
        return None

    # Run Gemini extraction
    print(f"  extracting triplets via Gemini...")
    triplets_by_url = extract_triplets(unique_fresh)

    # Update per-corpus snapshots
    corpus_root = PUBLIC_DATA / corpus
    summary = update_corpus(corpus_root, corpus, unique_fresh, triplets_by_url)

    # Record everything we processed (even ones that returned 0 triplets — no point re-trying)
    ledger.add_all(a.url for a in unique_fresh)
    ledger.save()

    print(
        f"  ✓ {summary['new_articles']} articles + {summary['new_edges']} edges "
        f"across months {summary['months_touched']}"
    )
    return summary


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None

    ledger = Ledger(LEDGER_PATH)
    print(f"Ledger holds {len(ledger)} previously-seen URLs")

    watchlist_paths = sorted(WATCHLIST_DIR.glob("*.yaml"))
    if target:
        watchlist_paths = [p for p in watchlist_paths if p.stem == target]
        if not watchlist_paths:
            raise SystemExit(f"No watchlist named '{target}' in {WATCHLIST_DIR}")

    summaries: list[dict] = []
    for path in watchlist_paths:
        try:
            s = _process_watchlist(path, ledger)
            if s:
                summaries.append(s)
        except Exception as exc:  # noqa: BLE001
            print(f"  [!] watchlist {path.name} failed: {exc}")

    # Refresh the top-level corpora manifest so the frontend can discover
    # which corpora currently have data.
    manifest = refresh_corpora_manifest(PUBLIC_DATA)

    # Final summary
    print("\n" + "=" * 60)
    if not summaries:
        print("No new articles ingested — corpus unchanged.")
    else:
        for s in summaries:
            print(f"  {s['corpus']:<20} +{s['new_articles']} articles  +{s['new_edges']} edges")
    print(f"Ledger now holds {len(ledger)} URLs")
    print(f"Corpora manifest lists {len(manifest['corpora'])} corpora")


if __name__ == "__main__":
    main()
