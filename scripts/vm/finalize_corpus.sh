#!/bin/bash
# Post-corpus finalization — run AFTER the chunked extraction completes.
#   0. Judge + refine the 2019-01..2021-01 slice (extracted earlier, never judged)
#   1. Corpus-level canonicalization over ALL judged chunks (UI grade, min-freq 2)
#   2. Republish the whole fnspid-qwen-vm source from the canonical corpus
#   3. Strict canonical GAT input (min-freq 5) + single-config rolling GAT (BPR, no edge feats)
#   4. Predictions JSON + enable the Predictions tab for the source, push
LOG=~/finalize_corpus.log
set -x
cd ~/eib

# 0. Judge + refine the 2019-2021 slice with OUR pipeline (no reuse of
# other runs' outputs — the full corpus goes through our chain end to end).
if [ ! -f "output/chunk_2019_2021_JudgeLLM_metrics_computation.csv" ]; then
  python3 - <<'PYEOF'
import pandas as pd
df = pd.read_csv("output/triplets_qwen2.5:14b_semi_cleaned_data_summary.csv", engine="python", on_bad_lines="skip")
d = df["date"].astype(str).str[:10]
sel = df[(d >= "2019-01-01") & (d <= "2021-01-03")]
sel.to_csv("output/chunk_2019_2021.csv", index=False)
print(f"2019-2021 slice: {len(sel)} rows")
PYEOF
  python3 components/metrics_computator.py --triplets-path output/chunk_2019_2021.csv --source-column summary >> $LOG 2>&1
fi

# 1+2. Canonicalize (UI grade) and republish the whole source
cd ~/eib-knowledge-graph && git pull --rebase origin main
CHUNKS=$(ls ~/eib/output/chunk_*_JudgeLLM_metrics_computation.csv | sed 's/^/--csv /' | tr '\n' ' ')
python3 -m scripts.canonicalize_corpus $CHUNKS --out ~/eib/output/canonical_ui.csv --min-freq 2 >> $LOG 2>&1
python3 -m scripts.publish_vm_output --csv ~/eib/output/canonical_ui.csv --triplets-column output_triplets \
  --source-id fnspid-qwen-vm --replace --push >> $LOG 2>&1

# 3. Strict GAT input + single-config rolling-window training (L4 GPU)
python3 -m scripts.canonicalize_corpus $CHUNKS --out ~/eib/output/gat_input.csv --min-freq 5 --strict >> $LOG 2>&1
python3 -m scripts.run_gat_single --csv ~/eib/output/gat_input.csv --eib-root ~/eib --loss ce \
  | tee ~/gat_single_metrics.json >> $LOG 2>&1

# 4. Predictions JSON for the source + flip the Predictions tab on
MRR=$(python3 - <<'PYEOF'
import json, re
txt = open("/home/alexandrapaiz/gat_single_metrics.json").read()
m = re.search(r"\{[^{}]*\"MRR\"[^{}]*\}", txt, re.S)
print(json.loads(m.group(0)).get("MRR", 0) if m else 0)
PYEOF
)
EIB_ROOT=~/eib python3 -m scripts.compute_gat_predictions \
  --csv ~/eib/output/gat_input.csv \
  --weights-dir ~/eib/weights/ce_noedge_original \
  --source-id fnspid-qwen-vm \
  --model-label "CE (No Edge Feats)" --mrr "$MRR" >> $LOG 2>&1

python3 - <<'PYEOF'
import json
p = "frontend/public/data/sources.json"
d = json.load(open(p))
for s in d["sources"]:
    if s["id"] == "fnspid-qwen-vm" and "predictions" not in s["features"]:
        s["features"].append("predictions")
json.dump(d, open(p, "w"), indent=2)
print("features updated")
PYEOF
git add frontend/public/data/sources/fnspid-qwen-vm frontend/public/data/sources.json
git commit -m "data: full-corpus finalization — canonical republish + GAT predictions"
git pull --rebase origin main && git push origin main
echo "FINALIZE_DONE $(date -u +%FT%TZ)" >> $LOG
