# EIB Knowledge Graph

**Live site: https://eib-knowledge-graph.vercel.app**

Financial news → knowledge graphs → predictions, end to end, for the EIB
sponsor project (IEOR 4737, Columbia — Summer 2026 team: Alexandra Paiz,
Pierre Pujol, Ruiwen Wang; five-semester project lineage documented in
the in-app report).

Every article passes a **three-LLM chain** — triplet extraction, Judge
LLM quality scoring, flagged-triplet refinement — running entirely on a
locally hosted Qwen 2.5 14B (benchmarked at parity with GPT-5.5, at $0
API cost), followed by corpus-level canonicalization, monthly graph
snapshots, and rolling-window GAT link prediction.

## What's on the site

| Data source | What it is |
| --- | --- |
| FNSPID — Full corpus | The complete 15-year semiconductor corpus (54,563 articles, 2009–2024) through the full pipeline; GAT predictions live (MRR 0.654 over 83 backtest months for the finalized half) |
| FNSPID — Pierre's run | Independent judged run + 10-config GAT sweep (CE No-Edge-Feats, MRR 0.7558) |
| STOXX Europe 600 (Live) | Refreshed every morning by a VM cron; industry filters, news factor model, monthly GAT retrain |
| S&P 100 (Live) | Full ~101-constituent US corpus, same daily pipeline |
| Project report | This project's full LaTeX report, viewable in-app |

Tabs per source: interactive **knowledge graph** (force layout, entity/
industry filters, time scrubber), **predictions** (FinDKG-style monthly
leaderboards from real GAT weights), **factor analysis** (five news
factors — attention, sentiment, consensus, novelty, materiality — with
PCA + KMeans archetype clusters and a daily history scrubber).

## Ask Claude about the data (MCP)

The deployment exposes an MCP endpoint so analysts can connect Claude
directly to the corpus and interrogate the news behind any node, factor,
or prediction:

```
https://eib-knowledge-graph.vercel.app/api/mcp
```

Seven read-only tools (news search, entity lookups, graphs, factors,
predictions). Setup + example prompts: [docs/MCP_CONNECTOR.md](docs/MCP_CONNECTOR.md).

## Repository map

```
frontend/            Next.js app (static export + /api/mcp) — deploys to Vercel
scraper/             Live-corpus pipeline: watchlists, enriched extraction,
                     judge/refine, factor model, LLM backend switch (Qwen/Gemini)
scripts/             Corpus canonicalization, snapshot cleanup, GAT training
                     wrapper, predictions computation, VM→site publisher
scripts/vm/          Orchestration scripts that run on the GPU VM
                     (daily cron, corpus lanes, finalization)
docs/report/         Full project report (LaTeX + compiled PDF)
docs/HANDOVER.md     Two-tier handover runbook (maintain vs. full rerun)
docs/MCP_CONNECTOR.md  Analyst MCP setup
backend/             Optional local FastAPI wrapper for development only —
                     production is fully static + serverless
```

The original team pipeline (extraction/judge/GAT components) is **not
duplicated here** — the VM runs it unmodified; everything in this repo
wraps or extends it.

## Running the frontend locally

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. All data ships as static JSON in
`frontend/public/data/`, so the app works fully offline — no backend, no
keys.

## Operations

- **Live refresh**: cron on the team GPU VM, 07:30 UTC daily
  (`scripts/vm/daily_factors.sh`) — scrape → three-LLM chain → factors →
  GAT → push (the push triggers the Vercel redeploy). Zero API cost.
- **Adding a corpus**: a watchlist YAML in `scraper/watchlists/` + an
  entry in `frontend/public/data/sources.json` + a sector map in
  `frontend/lib/sectors.ts`. No pipeline code changes.
- **Taking the project over** (accounts, keys, infrastructure):
  [docs/HANDOVER.md](docs/HANDOVER.md). Short version: production needs
  no API keys at all, and the site degrades gracefully to a permanent
  static archive if unmaintained.

Sponsor: European Investment Bank · Advisors: G. Bonavolontá,
O. Reichmann (EIB); Dr. A. Hirsa, M. Wang (Columbia)
