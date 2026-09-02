# Publishing VM pipeline output to the UI

**This is the publishing path for the FNSPID corpus** — the team's
production dataset, extracted by the eib-eval pipeline on the VM. (The
"STOXX Europe 600 (Live)" source is a separate experiment with its own
fully-automated GitHub Actions pipeline, `scrape-daily-factors.yml`; it
does not use this path.)

The team's triplet-extraction pipeline (eib-eval) runs on a VM and writes
CSVs like `output/triplets_<model>_..._summary.csv`. This repo ships a
publisher that converts those CSVs into the site's static data format and
pushes them — the push triggers the Vercel deploy, so the UI updates with
no manual step.

## One-time VM setup

1. **Deploy key** (so the VM can push without anyone's personal login):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/eibkg_deploy -N ""
   cat ~/.ssh/eibkg_deploy.pub
   ```
   Add the public key at GitHub → `ap4509-columbia/eib-knowledge-graph`
   → Settings → Deploy keys → *Add deploy key* → check **Allow write
   access**.

2. **Clone + deps**:
   ```bash
   GIT_SSH_COMMAND="ssh -i ~/.ssh/eibkg_deploy" \
     git clone git@github.com:ap4509-columbia/eib-knowledge-graph.git
   cd eib-knowledge-graph
   git config core.sshCommand "ssh -i ~/.ssh/eibkg_deploy"
   git config user.name "eib-vm-pipeline"
   git config user.email "vm@eibkg.local"
   pip install pandas networkx scipy numpy scikit-learn
   ```

## Publishing (after each pipeline run)

```bash
cd eib-knowledge-graph && git pull --rebase origin main
python -m scripts.publish_vm_output \
    --csv /path/to/eib-eval/output/triplets_gemini-2.5-flash_..._summary.csv \
    --source-id fnspid-19-20-semis \
    --replace --push
```

- `--replace` overwrites each affected month's snapshot instead of merging
  into it. Use it whenever the CSV contains rows that were published
  before — merging the same rows twice doubles edge weights. For a CSV of
  strictly *new* articles you can drop it.
- `--dry-run` first if unsure: parses and reports counts, writes nothing.
- To publish into a brand-new source (instead of updating FNSPID), pick a
  new `--source-id` and add a matching entry to
  `frontend/public/data/sources.json` (id, label, `features` — e.g.
  `["graph"]`).

## Automating it

Append the publish command to the tail of the pipeline's run script, or
add a cron entry on the VM:

```cron
30 7 * * * cd ~/eib-knowledge-graph && git pull --rebase origin main && \
  python -m scripts.publish_vm_output --csv ~/eib-eval/output/latest.csv \
  --source-id fnspid-19-20-semis --replace --push >> ~/publish.log 2>&1
```

That's the whole chain: VM pipeline → CSV → publisher → git push → Vercel
deploy → UI.

## Notes

- The publisher reuses the live STOXX pipeline's snapshot writer, so
  output gets everything that source has: per-month graph snapshots with
  layout positions, per-month article records, and raw per-article triplet
  files (`triplets/YYYY-MM.json`) for provenance.
- VM triplets carry no sentiment/materiality (the 6-tuple format has
  none); those fields default to neutral and only matter for the Factor
  analysis tab, which FNSPID doesn't enable.
- A `factors/latest.json` is also written as a side effect; it's unused
  unless the source's `features` include `"factors"`.
