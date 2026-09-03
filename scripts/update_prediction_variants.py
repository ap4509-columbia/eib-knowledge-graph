"""Register a predictions JSON as a model variant for a source.

The Predictions tab shows a Model switcher + metric comparison table
when a source ships predictions_variants.json. This script maintains
that index: it reads the metrics already embedded in the predictions
file (mrr/hits written by compute_gat_predictions) and upserts one
variant entry.

    python3 -m scripts.update_prediction_variants \
        --source-id fnspid-qwen-vm \
        --id gat --label "GAT · CE (No Edge Feats)" \
        --file predictions.json \
        --note "Baseline: rolling-window GAT, cross-entropy loss"

Variant order in the index = display order; the first entry is the
default selection. Re-running with an existing --id updates in place.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SOURCES = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data" / "sources"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source-id", required=True)
    ap.add_argument("--id", required=True, help="Variant id (stable slug)")
    ap.add_argument("--label", required=True, help="Shown on the switcher")
    ap.add_argument("--file", required=True,
                    help="Predictions filename under the source dir")
    ap.add_argument("--note", default=None,
                    help="One-line description (tooltip)")
    ap.add_argument("--first", action="store_true",
                    help="Place/move this variant first (default selection)")
    args = ap.parse_args()

    src = SOURCES / args.source_id
    pred_path = src / args.file
    preds = json.loads(pred_path.read_text())

    entry = {
        "id": args.id,
        "label": args.label,
        "file": args.file,
        "mrr": preds["mrr"],
        "hits1": preds.get("hits1"),
        "hits3": preds.get("hits3"),
        "hits10": preds.get("hits10"),
        "months": len(preds.get("periods", {})),
    }
    if args.note:
        entry["note"] = args.note

    idx_path = src / "predictions_variants.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"variants": []}
    variants = [v for v in idx["variants"] if v["id"] != args.id]
    if args.first:
        variants.insert(0, entry)
    else:
        variants.append(entry)
    idx["variants"] = variants
    idx_path.write_text(json.dumps(idx, indent=2))
    print(f"{idx_path}: {[v['id'] for v in variants]} "
          f"({args.id}: MRR {entry['mrr']:.3f}, {entry['months']} months)")


if __name__ == "__main__":
    main()
