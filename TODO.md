# TODO

Follow-ups to pick up when working on the UI or the scraper next.

## UI

- ~~**Timeline: support a date-range selector, not just a fixed point.**~~
  Done. The slider is dual-thumb, months in range are fetched in parallel and
  folded together by `frontend/lib/mergeSnapshots.ts`, and the header, forecast
  badge, and node detail sheet all read the range. Preset chips (1M/3M/6M/12M/
  All) anchor trailing windows on the range's right edge.
  Follow-ups this opened:
    - **Min-degree filter over-prunes wide ranges.** The threshold is a
      percentage of max degree, and hub degrees grow much faster than the tail
      as months are added — so at the default 5% a 24-month range shows ~28
      entities where a single month shows ~76. Widening the range makes the
      graph *smaller*, which reads as a bug. Options: normalize degree per
      month, switch to an absolute threshold, or keep the percentage and
      auto-lower it as the range widens. Worth a team call.
    - **Merged layout is a heuristic, not a re-solved layout.** Positions are
      precomputed per month by `spring_layout`, and each month's run has an
      arbitrary rotation/reflection, so they can't be averaged. The merger
      adopts one month's layout wholesale (most-covered month = anchor), pulls
      the remaining nodes to their neighbors' centroid over 6 passes, and puts
      components that never reach the anchor in an outer halo. It renders
      instantly and is deterministic, but it doesn't reflect merged-graph
      structure. The physics toggle is the escape hatch. A real fix is
      precomputing range layouts in the backend, which doesn't scale to every
      possible range — or accepting a one-off client layout for wide ranges.
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
