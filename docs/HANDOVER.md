# Handover — running this system on your own accounts

This project is designed so a successor (next semester's team, or a
sponsor engineer) can take it over completely by swapping a small set of
account bindings. Nothing in the code is tied to a person; everything
account-specific lives in the places listed here.

A security note first: the deployed site is **static and public**, so it
cannot accept or store credentials — there is deliberately no "enter
your API key" form. Keys belong in each platform's secret store, listed
below. The UI's settings dialog links to this document.

## 1. What runs where

| Piece | Where it runs | What it needs |
| --- | --- | --- |
| Web app + `/api/mcp` | Vercel, auto-deploy on push to `main` | A Vercel project linked to the repo |
| Data (graphs, factors, predictions) | Static JSON inside the repo (`frontend/public/data/`) | Nothing — travels with the repo |
| Daily live-corpus refresh | Cron on the GPU VM (`scripts/vm/daily_factors.sh`, 07:30 UTC) | VM + Ollama + a deploy key that can push |
| Full-corpus pipeline runs | tmux lanes on the VM (`scripts/vm/run_lane.sh`) | VM + the team pipeline repo copy |
| Fallback scraper (no VM) | GitHub Actions (`.github/workflows/scrape-daily-factors.yml`, manual dispatch) | `GEMINI_API_KEY` repo secret |

## 2. Account touchpoints (the complete list)

1. **GitHub repository** — `ap4509-columbia/eib-knowledge-graph` (public).
   Collaborators can push; the repo owner controls settings and secrets.
2. **Vercel project** — `eib-knowledge-graph` on the Columbia team
   (`ap4509-columbias-projects`), watching the GitHub repo. No env vars
   are required for the static site or the MCP endpoint.
3. **GCP project** — `eib-summer-26`, VM `eib-central1a`
   (us-central1-a, g2-standard-4, 1×L4). SSH via IAP tunnel with any
   authorized Google account. Billing: course coupon.
4. **VM deploy key** — a write-scoped GitHub deploy key on the repo lets
   the VM push data commits (commits appear as "eib-vm-pipeline").
5. **`GEMINI_API_KEY`** — GitHub Actions secret, used only by the
   fallback workflows. Production uses local Qwen: no key at all.
6. **Ollama on the VM** — local `qwen2.5:14b`; `OLLAMA_NUM_PARALLEL=2`
   set via systemd override. No account, no key.

## 3. Transfer checklist

Do these in order; each step is independent, so partial handover also
works (e.g. keep the site, drop the VM).

1. **Repo**: either transfer ownership (GitHub Settings → Transfer) or
   fork. All data, code, and docs travel with it.
2. **Vercel**: create a project on YOUR Vercel account, import the repo,
   framework preset Next.js, root directory `frontend/`. First deploy
   gives you your own URL; nothing else to configure. If you want the
   MCP connector, its endpoint is `<your-url>/api/mcp` automatically.
3. **VM** (only if you want live corpora + future pipeline runs):
   any GPU box with Ollama works.
   - `ollama pull qwen2.5:14b`; set `OLLAMA_NUM_PARALLEL=2`.
   - Clone your repo; `pip install -r` the team pipeline's requirements.
   - Generate a deploy key: `ssh-keygen -t ed25519`; add the public half
     as a write-enabled deploy key on YOUR repo; configure the VM's git
     to use it.
   - Install the cron: `crontab -e` →
     `30 7 * * * $HOME/daily_factors.sh` (copy the scripts from
     `scripts/vm/`; they are `$HOME`-relative).
4. **Keys**: create your own Gemini key only if you want the Actions
   fallback; set it as the `GEMINI_API_KEY` secret on your repo. The
   env-var config surface for all LLM stages is:
   `EIBKG_LLM_BACKEND` (`ollama`|`gemini`), `EIBKG_LLM_MODEL`,
   `OLLAMA_HOST`, `GEMINI_API_KEY`.
5. **Watchlists / corpora**: everything corpus-specific is a YAML in
   `scraper/watchlists/` plus an entry in
   `frontend/public/data/sources.json` plus (for the industry filter) a
   keyword map in `frontend/lib/sectors.ts`. Adding or retiring a corpus
   never requires touching pipeline code.
6. **Report**: LaTeX source in `docs/report/`; after editing, recompile
   and copy the PDF to `frontend/public/report.pdf` (the app serves that
   copy).

## 4. If nobody takes over

The system degrades gracefully rather than breaking: the Vercel site
keeps serving the last-published state indefinitely (static files), the
FNSPID corpora and predictions remain browsable, and only the two live
corpora stop advancing — their Live badges will simply show a stale
date. The VM can be deleted once its last outputs are pushed; nothing
on the site depends on it at runtime.

## 5. Current operational facts (August 2026)

- Daily cron: 07:30 UTC on the VM, both live corpora, local Qwen.
- STOXX cron scheduled to be reviewed/turned off after Sep 12, 2026.
- Full-corpus FNSPID run: 2009–2016 finalized and live; remaining
  chunks in checkpointed tmux lanes on the VM.
- MCP endpoint: `https://eib-knowledge-graph.vercel.app/api/mcp`
  (see `docs/MCP_CONNECTOR.md`).
