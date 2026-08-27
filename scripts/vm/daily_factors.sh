#!/bin/bash
# Daily live-corpus refresh — STOXX Europe 600 + S&P 100 — local Qwen, $0 API.
# Per corpus: scrape + judge/refine + factor rollup, then (once >=3 month
# snapshots exist) GAT retrain + predictions. Cron: 30 7 * * *
# Replaces stoxx_daily.sh (kept for reference, no longer cronned).
LOG=~/daily_factors.log
{
echo "=== daily factors $(date -u +%FT%TZ) ==="
cd ~/eib-knowledge-graph || exit 1
git pull --rebase origin main
export EIBKG_LLM_BACKEND=ollama
export EIBKG_LLM_MODEL=qwen2.5:14b

# corpus:short-tag (tag namespaces GAT weights + strategy label)
for PAIR in stoxx_600_factors:stoxx sp100_factors:sp100; do
  CORPUS=${PAIR%%:*}
  TAG=${PAIR##*:}
  echo "--- $CORPUS: scrape + factors ---"
  python3 -m scraper.run_daily_factors --watchlist "$CORPUS" --articles-per-ticker 3

  # Corpus-level canonicalization, daily: deterministic suffix/case merges
  # + conservative fuzzy pass, then recompute factors from the cleaned
  # snapshots. Keeps duplicate entities from accumulating between the
  # per-run LLM canonicalization calls. GAT below trains on cleaned data.
  echo "--- $CORPUS: canonicalize snapshots ---"
  python3 -m scripts.clean_snapshots --corpus "frontend/public/data/sources/$CORPUS" --sim 0.85 --watchlist "$CORPUS"
  python3 -m scraper.run_daily_factors --watchlist "$CORPUS" --factors-only

  SNAPS=$(ls "frontend/public/data/sources/$CORPUS/snapshots/"*.json 2>/dev/null | wc -l)
  # Rolling window trains on 3 months and predicts a 4th, so anything
  # under 4 snapshots yields zero training cases.
  if [ "$SNAPS" -lt 4 ]; then
    echo "--- $CORPUS: only $SNAPS month snapshot(s) (<4), skipping GAT ---"
    continue
  fi

  echo "--- $CORPUS: GAT retrain + predictions ---"
  python3 -m scripts.stoxx_gat_prep --corpus "frontend/public/data/sources/$CORPUS" --out "/tmp/${TAG}_gat.csv"
  python3 -m scripts.run_gat_single --csv "/tmp/${TAG}_gat.csv" --eib-root ~/eib --loss ce --strategy "$TAG" \
    > "/tmp/${TAG}_gat_metrics.log" 2>&1
  read MRR H1 H3 H10 <<< $(python3 -c "
import json, re
txt = open('/tmp/${TAG}_gat_metrics.log').read()
m = re.search(r'\{[^{}]*MRR[^{}]*\}', txt, re.S)
d = json.loads(m.group(0)) if m else {}
print(round(d.get('MRR',0),3), round(d.get('Hits@1',0),3), round(d.get('Hits@3',0),3), round(d.get('Hits@10',0),3))")
  EIB_ROOT=~/eib python3 -m scripts.compute_gat_predictions --csv "/tmp/${TAG}_gat.csv" \
    --weights-dir ~/eib/weights/"ce_noedge_${TAG}" --source-id "$CORPUS" \
    --strategy "$TAG" --model-label "CE (No Edge Feats)" --mrr "$MRR" \
    --hits1 "$H1" --hits3 "$H3" --hits10 "$H10"

  # Ensure the Predictions tab is on for this source once predictions exist.
  python3 - "$CORPUS" <<'PYEOF'
import json, sys
sid = sys.argv[1]
p = "frontend/public/data/sources.json"
d = json.load(open(p))
for s in d["sources"]:
    if s["id"] == sid and "predictions" not in s.get("features", []):
        s.setdefault("features", []).append("predictions")
        json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
        print(f"features: enabled predictions for {sid}")
PYEOF
done

git add frontend/public/data/sources frontend/public/data/sources.json scraper/state
git commit -m "chore: live corpora refresh $(date -u +%F) (vm/qwen + GAT)" || echo "nothing to commit"
for i in 1 2 3; do
  git pull --rebase origin main && git push origin main && break
  sleep 10
done
echo "=== done $(date -u +%FT%TZ) ==="
} >> $LOG 2>&1
