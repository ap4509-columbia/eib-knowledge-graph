# TODO

Follow-ups to pick up when working on the UI or the scraper next.

## Data quality — entity types

Type normalization landed (`_classify_entity_type` in `backend/runner.py`):
36 distinct types collapsed to 18, and the ~24 junk singletons that cluttered
the filter rail are gone. It rewrites **only the type label** — node ids, edge
tuples, and edge weights are byte-identical across all 24 snapshots, verified
against the previous output, so anything joining on entity identity (the GAT
scores) still lines up. 34 node-months changed type.

What is still open, and needs a team call:

- **`CURRENCY` is 126 nodes of bare numerals** — `'1840'`, `'8815'`, `'8071'`.
  The *type* is canonical so normalization doesn't touch it; the *entities* are
  extraction debris. Same for the numerals now sitting in UNK (`'351'`,
  `'677091'`). Cleaning these means dropping nodes, which changes node/edge
  counts and could desync the GAT join — hence not done unilaterally.
- **Column misalignment in the source triplets.** Some rows put the entity's
  own name in the type slot (type=`TSMC` on an entity named `'Ltd'`;
  type=`RESIDENTIAL` on `'iShares'`) and one case leaked a `rel_cat` value
  (`GMM`) into the type column. These are now UNK, but the rows themselves are
  broken. Worth checking whether `_parse_triplets` can detect the shift, or
  whether it needs fixing upstream in the extraction.
- **Whether to promote `PERSON` / `COUNTRY` / `LOCATION` / `INSTITUTION` to
  first-class schema types.** They're real extractions (Jensen Huang, China,
  Mizuho) that the schema has no slot for. Currently passed through unchanged
  rather than crushed to UNK — see `_UNMODELED_ENTITY_TYPES`. Promoting them
  means updating `types.ts` and the sponsor-facing entity taxonomy.
- **Upstream vs downstream.** These snapshots derive from the Spring 2026
  team's `summary_triplets_19_20.csv`. Patching in our runner and fixing in
  their extraction will diverge; worth agreeing with Pierre which side owns it.

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
