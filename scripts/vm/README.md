# VM driver scripts

Copies of the shell scripts that orchestrate the pipeline on the team GPU
VM (`eib-central1a`, GCP project eib-summer-26). The VM's home directory
holds the live versions; these are synced here so the whole workflow is
reviewable in one place.

Important: these scripts do NOT modify the original team pipeline. The
VM keeps unmodified working copies of the team's pipeline repo
(`~/eib`, plus `~/eib2` / `~/eib3` duplicates so parallel lanes don't
collide on the per-workdir ontology SQLite lock) and calls its
components as-is (`triplet_generator.py`, `metrics_computator.py`,
`gat.py` via `scripts/run_gat_single.py`). All new logic lives in this
repository under `scraper/` and `scripts/`.

| Script | Role |
| --- | --- |
| `run_lane.sh` | One parallel corpus lane: per date-chunk, extract (qwen2.5:14b) → slice from the master CSV → Judge LLM + third-LLM refinement (`metrics_computator.py`) → publish to `fnspid-qwen-vm` |
| `finalize_half.sh` | Interim finalization over 2009–2016: canonicalize → republish → strict GAT input → CE GAT → predictions |
| `finalize_corpus.sh` | Full-corpus finalization (same chain over every judged chunk, incl. the 2019–2021 self-judged slice) |
| `daily_factors.sh` | 07:30 UTC cron: STOXX Europe 600 + S&P 100 live refresh (scrape → enrich → factors → GAT once ≥3 months) |
| `sp100_bootstrap.sh` | One-shot first scrape that seeded the S&P 100 corpus |
