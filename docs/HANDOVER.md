# Handover — running this system on your own accounts

This project is designed so a successor (next semester's team, or a
sponsor engineer) can take it over by swapping a small set of account
bindings. Nothing in the code is tied to a person.

There are two very different sizes of handover. Pick the one you need:

- **Part 1 — Maintain what is live.** The FNSPID corpus is a finished,
  static artifact baked into the repo; it needs no infrastructure ever
  again. Maintaining the project means: keep the site deployed and keep
  the two live corpora (STOXX Europe 600, S&P 100) refreshing daily.
- **Part 2 — Rerun the full pipeline.** Only needed if you want to
  re-extract or re-judge a corpus (new date range, new model, new
  universe at scale). This is the heavy tier: GPU, team pipeline copy,
  chunked lanes.

A security note: the deployed site is **static and public**, so it
cannot accept or store credentials — there is deliberately no "enter
your API key" form. Keys belong in each platform's secret store, as
listed below. The UI's settings dialog links to this document.

## Part 0 — Do nothing (baseline)

If nobody takes over, nothing breaks: the Vercel site keeps serving its
last-published state indefinitely (everything is static JSON in the
repo), the FNSPID corpora and all predictions remain browsable, and the
MCP endpoint keeps answering. Only the two live corpora stop advancing —
their Live badges will show a stale date. The VM can be deleted once its
last outputs are pushed; nothing on the site depends on it at runtime.

## Part 1 — Maintain what is live

What you need: a GitHub account, a Vercel account, and ONE of the two
refresh options below. No API key is required for option A.

1. **Repo**: take ownership — GitHub Settings → Transfer (or fork).
   All code, data, and docs travel with it.
2. **Vercel**: create a project on your Vercel account, import the repo,
   framework preset Next.js, root directory `frontend/`. Zero env vars.
   Your URL serves the site and the MCP endpoint (`/api/mcp`)
   automatically.
3. **Daily refresh — option A (recommended, $0): any GPU box.**
   - Install Ollama, `ollama pull qwen2.5:14b`.
   - Clone your repo; install `scraper/` Python deps.
   - Generate a deploy key (`ssh-keygen -t ed25519`), add the public
     half as a write-enabled deploy key on your repo, point the box's
     git at it.
   - Copy `scripts/vm/daily_factors.sh` to `$HOME` and install the cron:
     `30 7 * * * $HOME/daily_factors.sh`.
   - That's it — the script scrapes, runs the three-LLM chain on local
     Qwen, recomputes factors, retrains the live GAT, and pushes; the
     push redeploys the site.
4. **Daily refresh — option B (no GPU): GitHub Actions + Gemini.**
   The repo contains a ready fallback workflow
   (`.github/workflows/scrape-daily-factors.yml`, currently manual
   dispatch). Create your own Gemini API key, set it as the
   `GEMINI_API_KEY` secret on your repo, and re-enable the workflow's
   schedule. Costs cents per day. This is the ONLY place a Gemini key
   is ever used — production runs entirely on local Qwen, and if you
   choose option A you need no API key anywhere.
5. **Corpus configuration** (only when you want to change coverage):
   each corpus is a YAML watchlist in `scraper/watchlists/` + an entry
   in `frontend/public/data/sources.json` + a sector keyword map in
   `frontend/lib/sectors.ts`. Adding or retiring a corpus never touches
   pipeline code.
6. **Report**: LaTeX in `docs/report/`; after edits, recompile and copy
   the PDF to `frontend/public/report.pdf` (the app serves that copy).

Config surface for the LLM stages (env vars, already wired):
`EIBKG_LLM_BACKEND` (`ollama`|`gemini`), `EIBKG_LLM_MODEL`,
`OLLAMA_HOST`, `GEMINI_API_KEY` (option B only).

## Part 2 — Rerun the full pipeline

Everything in Part 1, plus:

1. **A real GPU machine** (the run used one NVIDIA L4, 23 GB). Batch
   throughput on qwen2.5:14b: extraction ≈9 s/article, judge+refine
   ≈25 s/article — budget GPU-days accordingly (the 54,563-article
   FNSPID corpus took on the order of a week on one L4 with two lanes).
2. **The team pipeline repo** (extraction/judge/GAT components),
   cloned per parallel lane — each lane needs its own working copy
   because the pipeline keeps a per-directory ontology SQLite store.
   Set `OLLAMA_NUM_PARALLEL=2` (systemd override) to share the GPU.
3. **Orchestration scripts** in `scripts/vm/` (all `$HOME`-relative):
   - `run_lane.sh` — chunked extract → slice → judge/refine → publish,
     checkpointed per article, restartable.
   - `finalize_corpus.sh` / `finalize_half.sh` — canonicalize →
     republish → strict GAT input → CE GAT training → predictions →
     flip the Predictions tab → push.
4. **Publishing** — `scripts/publish_vm_output.py` turns pipeline CSVs
   into the site's data format; it runs inside the lane/finalize
   scripts. The machine pushes with the same deploy key as Part 1.
5. **GCP specifics of the 2026 setup** (if inheriting the original VM
   rather than building fresh): project `eib-summer-26`, VM
   `eib-central1a` (us-central1-a, g2-standard-4, 1×L4), SSH via IAP
   tunnel, billing on the course coupon. A disk snapshot
   (`eib-pipeline-clone`) exists for cloning workers.

## Current operational facts (August 2026)

- Daily cron: 07:30 UTC on the VM, both live corpora, local Qwen,
  zero API cost.
- STOXX cron scheduled for review/shutoff after Sep 12, 2026.
- Full-corpus FNSPID run: 2009–2016 finalized and live; remaining
  chunks in checkpointed tmux lanes on the VM.
- MCP endpoint: `https://eib-knowledge-graph.vercel.app/api/mcp`
  (see `docs/MCP_CONNECTOR.md`).
