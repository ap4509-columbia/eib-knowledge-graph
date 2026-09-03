"""Train ONE rolling-window GAT configuration on a triplets CSV.

The team's gat.py always trains all 10 loss/feature configurations per
strategy — fine for a benchmark, a 10x waste for production. This wrapper
imports their training machinery and runs a single configuration (default:
BPR, no edge features — the Fall 2025 leaderboard winner at MRR 0.8018).

Checkpoints land in <eib-root>/weights/<loss>_<edge|noedge>_<strategy>/
one .pt per validation month — exactly what compute_gat_predictions.py
consumes.

    python3 -m scripts.run_gat_single \
        --csv ~/eib/output/gat_input.csv --eib-root ~/eib \
        [--loss bpr] [--edge-types] [--strategy original]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Per-loss training hyperparameters, mirroring gat.py's base_configs.
LOSS_PARAMS = {
    "findkg": {"epochs": 200, "lr": 1e-3},
    "bpr": {"epochs": 200, "lr": 1e-3},
    "ce": {"epochs": 200, "lr": 1e-3},
    "hybrid": {"epochs": 100, "lr": 5e-4},
    "infonce": {"epochs": 200, "lr": 1e-4},
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--csv", required=True, type=Path)
    ap.add_argument("--eib-root", required=True, type=Path,
                    help="Path to the eib pipeline repo (provides "
                    "components/ and utils/; weights/ is written there).")
    ap.add_argument("--loss", default="bpr", choices=sorted(LOSS_PARAMS))
    ap.add_argument("--edge-types", action="store_true")
    ap.add_argument("--arch", default="gat", choices=["gat", "sage"],
                    help="Model architecture: the team GATLP (default) or "
                    "the GraphSAGE counterpart (scripts/sage_model.py), "
                    "swapped in without modifying team code.")
    ap.add_argument("--strategy", default="original",
                    help="Column-selection strategy label. Use 'original' "
                    "when the CSV was already strict-filtered upstream "
                    "(e.g. by canonicalize_corpus --strict).")
    args = ap.parse_args()

    eib_root = args.eib_root.expanduser().resolve()
    csv_path = args.csv.expanduser().resolve()
    # gat.py resolves weights/ and logs/ relative to the CWD.
    os.chdir(eib_root)
    sys.path.insert(0, str(eib_root))

    from components.gat import run_experiment_case  # noqa: E402
    if args.arch == "sage":
        # Swap the architecture the trainer instantiates. SAGE has no
        # edge-feature pathway, so force the no-edge config.
        import components.gat as _gat_mod
        from scripts.sage_model import SAGELP
        _gat_mod.GATLP = SAGELP
        args.edge_types = False
    from utils.data_utils import load_df_from_csv  # noqa: E402
    from utils.gat_utils import build_type_map  # noqa: E402

    df = load_df_from_csv(csv_path, strategy=args.strategy)
    if df.empty:
        raise SystemExit(f"No rows loaded from {csv_path}")

    global_type2id = build_type_map(df)
    all_nodes = set(df["sub"].unique()) | set(df["obj"].unique())
    global_node2id = {n: i + 1 for i, n in enumerate(sorted(all_nodes))}
    print(f"Loaded {len(df)} triplet rows, {len(global_node2id)} unique nodes")

    p = LOSS_PARAMS[args.loss]
    arch_prefix = "" if args.arch == "gat" else f"{args.arch}_"
    fs = f"{arch_prefix}{args.loss}_{'edge' if args.edge_types else 'noedge'}_{args.strategy}"
    case = {
        "name": f"{args.loss.upper()} ({'Rel+Cat+NormW' if args.edge_types else 'No Edge Feats'})",
        "fs_name": fs,
        "edge_types": args.edge_types,
        "loss": args.loss,
        "epochs": p["epochs"],
        "learning_rate": p["lr"],
    }
    metrics = run_experiment_case(df, case, global_type2id, global_node2id)
    print(json.dumps({"config": fs, **{k: float(v) for k, v in metrics.items()}}, indent=2))
    print(f"Checkpoints: {eib_root / 'weights' / fs}/")


if __name__ == "__main__":
    main()
