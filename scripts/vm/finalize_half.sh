#!/bin/bash
# Interim half-corpus finalization: 2009-2016 (chunks 2009_2013 + 2014_2016),
# both fully judged+refined. Canonicalize -> republish -> strict GAT input ->
# CE GAT -> predictions -> flip Predictions tab. The full-corpus
# finalize_corpus.sh re-runs everything when half 2 (2017-2024) lands.
LOG=~/finalize_half.log
set -x
CSVS="--csv $HOME/eib/output/chunk_2009_2013_JudgeLLM_metrics_computation.csv --csv $HOME/eib/output/chunk_2014_2016_JudgeLLM_metrics_computation.csv"

cd ~/eib-knowledge-graph && git pull --rebase origin main
python3 -m scripts.canonicalize_corpus $CSVS --out ~/eib/output/canonical_half_ui.csv --min-freq 2 >> $LOG 2>&1
python3 -m scripts.publish_vm_output --csv ~/eib/output/canonical_half_ui.csv --triplets-column output_triplets \
  --source-id fnspid-qwen-vm --replace --push >> $LOG 2>&1

python3 -m scripts.canonicalize_corpus $CSVS --out ~/eib/output/gat_input_half.csv --min-freq 5 --strict >> $LOG 2>&1
python3 -m scripts.run_gat_single --csv ~/eib/output/gat_input_half.csv --eib-root ~/eib --loss ce \
  | tee ~/gat_half_metrics.json >> $LOG 2>&1

MRR=$(python3 - <<PYEOF
import json, re
txt = open("$HOME/gat_half_metrics.json").read()
m = re.search(r"\{[^{}]*\"MRR\"[^{}]*\}", txt, re.S)
print(json.loads(m.group(0)).get("MRR", 0) if m else 0)
PYEOF
)
EIB_ROOT=~/eib python3 -m scripts.compute_gat_predictions \
  --csv ~/eib/output/gat_input_half.csv \
  --weights-dir ~/eib/weights/ce_noedge_original \
  --source-id fnspid-qwen-vm \
  --model-label "CE (No Edge Feats)" --mrr "$MRR" >> $LOG 2>&1

python3 - <<PYEOF
import json
p = "frontend/public/data/sources.json"
d = json.load(open(p))
for s in d["sources"]:
    if s["id"] == "fnspid-qwen-vm" and "predictions" not in s["features"]:
        s["features"].append("predictions")
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
print("features updated")
PYEOF
git add frontend/public/data/sources/fnspid-qwen-vm frontend/public/data/sources.json
git commit -m "data: interim half-corpus (2009-2016) canonical republish + GAT predictions"
for i in 1 2 3; do git pull --rebase origin main && git push origin main && break; sleep 15; done
echo "FINALIZE_HALF_DONE $(date -u +%FT%TZ)" >> $LOG
