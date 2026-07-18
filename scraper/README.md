# Self-updating scraper

A GitHub Actions cron runs `python scraper/run_daily.py` every day at 06:00 UTC.
It fetches news from free sources, dedups against a URL ledger, sends new
articles to Gemini for triplet extraction, and updates the per-corpus
snapshot JSONs the frontend reads from.

## Layout

```
scraper/
├── sources/            # one file per news source
│   ├── google_news.py
│   ├── yahoo_finance.py
│   └── rss_feeds.py
├── watchlists/         # declarative YAML — one file per corpus
│   ├── us_semis.yaml
│   ├── eu_utilities.yaml
│   ├── eu_banks.yaml
│   └── eu_regulators.yaml
├── prompts/
│   └── triplet_extraction.txt   # copied from past team's tgp.txt
├── state/
│   └── seen_urls.json           # dedup ledger, committed
├── ledger.py           # ledger helper
├── extraction.py       # Gemini wrapper
├── snapshots.py        # merges triplets into per-corpus snapshot JSONs
├── run_daily.py        # main entry point
└── requirements.txt
```

## Where the data ends up

```
frontend/public/data/
├── us_semis/
│   ├── index.json
│   ├── snapshots/2026-07.json
│   └── articles/2026-07.json
├── eu_utilities/
│   └── ...
└── eu_banks/
    └── ...
```

The frontend's fetch layer can start reading per-corpus paths by prefixing
requests with the corpus name (e.g. `/data/eu_utilities/index.json`).

## Local run

```bash
# All watchlists
python scraper/run_daily.py

# One watchlist
python scraper/run_daily.py eu_utilities
```

Reads `GEMINI_API_KEY` from `backend/.env`.

## GitHub Actions setup (one-time)

1. Go to the repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `GEMINI_API_KEY`, value: your key
4. Done. The daily cron will start running the next 06:00 UTC.

Also visible: **Actions tab → Daily corpus refresh → Run workflow** for manual
triggers (with an optional single-watchlist parameter).

## Adding a new corpus

Drop a new YAML file in `watchlists/`. Example:

```yaml
corpus: my_new_corpus
description: What this corpus is for.

sources:
  - google_news
  - yahoo_finance

tickers:
  - AAPL
  - MSFT

# Optional — RSS-only corpora don't need tickers
rss_feeds:
  - https://example.com/feed.xml
```

Commit + push → next scheduled run picks it up.

## Cost

- GitHub Actions: free on public repos
- All news sources: free (RSS or unlimited public endpoints)
- Gemini API: ~$0.0002 per article, ~$3/year at typical volumes

See the main README's "Deployment" section for how this ties into the
Vercel static build.
