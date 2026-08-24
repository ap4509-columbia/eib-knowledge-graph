#!/bin/bash
# Parallel corpus lane. Usage: run_lane.sh <workdir> <logfile> <chunks...>
# where each chunk is START:END:TAG. Two lanes share the L4 via
# OLLAMA_NUM_PARALLEL=2.
WORKDIR=$1; LOG=$2; shift 2
MODEL="qwen2.5:14b"
MASTER="output/triplets_${MODEL}_semi_cleaned_data_summary.csv"

run_chunk() {
  S=$1; E=$2; TAG=$3
  echo "=== CHUNK $TAG ($S -> $E) start $(date -u +%FT%TZ) ===" >> $LOG
  cd $WORKDIR
  python3 components/triplet_generator.py --model-name $MODEL --data-type semi_cleaned_data --text-column summary --start-date $S --end-date $E >> $LOG 2>&1 \
    || { echo "CHUNK $TAG: generator FAILED" >> $LOG; return 1; }
  python3 - "$S" "$E" "$TAG" "$MASTER" >> $LOG 2>&1 <<'PYEOF'
import sys
import pandas as pd
s, e, tag, master = sys.argv[1:5]
try:
    df = pd.read_csv(master)
except Exception:
    df = pd.read_csv(master, engine="python", on_bad_lines="skip")
d = df["date"].astype(str).str[:10]
sel = df[(d >= s) & (d <= e)]
sel.to_csv(f"output/chunk_{tag}.csv", index=False)
print(f"chunk {tag}: {len(sel)} rows sliced from master")
PYEOF
  [ -s "output/chunk_${TAG}.csv" ] || { echo "CHUNK $TAG: empty slice" >> $LOG; return 1; }
  python3 components/metrics_computator.py --triplets-path "output/chunk_${TAG}.csv" --source-column summary >> $LOG 2>&1 \
    || { echo "CHUNK $TAG: judge FAILED" >> $LOG; return 1; }
  cd ~/eib-knowledge-graph
  for i in 1 2 3; do
    git pull --rebase origin main >> $LOG 2>&1
    python3 -m scripts.publish_vm_output --csv $WORKDIR/output/chunk_${TAG}_JudgeLLM_metrics_computation.csv --triplets-column "Revised triplets" --source-id fnspid-qwen-vm --replace --push >> $LOG 2>&1 && break
    echo "CHUNK $TAG: publish attempt $i failed, retrying" >> $LOG; sleep 20
  done
  echo "=== CHUNK $TAG done $(date -u +%FT%TZ) ===" >> $LOG
}

for spec in "$@"; do
  IFS=: read S E TAG <<< "$spec"
  run_chunk "$S" "$E" "$TAG"
done
echo "=== LANE COMPLETE $(date -u +%FT%TZ) ===" >> $LOG
