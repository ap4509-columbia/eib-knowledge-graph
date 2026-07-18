# TODO

Follow-ups to pick up when working on the UI or the scraper next.

## UI

- **Timeline: support a date-range selector, not just a fixed point.**
  Currently the time slider picks a single month. Team feedback: analysts
  want to select a range (e.g., "Q1 2020 through Q2 2021") and see the KG
  aggregated across that window. Requires:
    - Dual-thumb range slider component (or two-thumb version of current
      Slider primitive)
    - Snapshot merger on the fetch side: when a range is picked, union the
      nodes across all selected months and sum edge weights across the range
    - "Currently viewing" header updated to show the range instead of one month
    - Chat panel's month-range picker already does this — the same UX
      pattern can be lifted to the main timeline
- Confirm all UI code is in the GitHub repo (spot-check `frontend/` after
  every scraper push)

## Scraper

- **Do not use Yahoo Finance.** Team explicitly opted out. All watchlists
  currently use `google_news` only. The `scraper/sources/yahoo_finance.py`
  module still exists for reference but is not referenced from any YAML.
  If you want to remove it entirely, delete the file and update `README.md`.
- Add per-corpus schedules (e.g., US corpora on weekday market hours only,
  EU regulators daily) — currently one cron for all
- Add sentiment scores from Marketaux or a similar API as a second
  signal alongside Gemini's triplet output

## Model integration (blocked on Spring 2026 team)

- Get per-edge GAT confidence scores exported as CSV; wire into the edge
  styling as a "confidence" color mode
- Get node embeddings; surface "similar entities" in the detail panel

## Deployment

- Once the scheduled workflow is running, verify Vercel picks up the
  auto-commits and redeploys cleanly
- Move backend to a permanent host if the sponsor wants an always-on
  demo URL that doesn't depend on Alexandra's laptop (currently backend
  is optional — static Vercel build serves everything)
