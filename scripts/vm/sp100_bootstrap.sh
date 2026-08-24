#!/bin/bash
LOG=~/sp100_bootstrap.log
{
echo "=== sp100 bootstrap $(date -u +%FT%TZ) ==="
cd ~/eib-knowledge-graph || exit 1
git pull --rebase origin main
export EIBKG_LLM_BACKEND=ollama
export EIBKG_LLM_MODEL=qwen2.5:14b
python3 -m scraper.run_daily_factors --watchlist sp100_factors --articles-per-ticker 3
git add frontend/public/data/sources/sp100_factors scraper/state
git commit -m "feat: bootstrap S&P 100 live corpus (vm/qwen first run)" || echo "nothing to commit"
for i in 1 2 3; do
  git pull --rebase origin main && git push origin main && break
  sleep 10
done
echo "=== sp100 bootstrap done $(date -u +%FT%TZ) ==="
} >> $LOG 2>&1
