"""Convert a STOXX corpus (month snapshot JSONs) into the CSV shape the
GAT trainer consumes.

The FNSPID pipeline hands gat.py a CSV of articles with `output_triplets`.
STOXX lives as monthly snapshot JSONs (aggregated edges with weights), so
we emit one synthetic row per month carrying that month's edge set as
dict-triplets (data_utils._norm_triplet accepts {'sub', 'rel', 'obj',
'sub_type', 'obj_type', 'rel_category', 'w'} — weights survive).

    python3 -m scripts.stoxx_gat_prep \
        --corpus frontend/public/data/sources/stoxx_600_factors \
        --out /tmp/stoxx_gat.csv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    rows = []
    for snap_path in sorted((args.corpus / "snapshots").glob("*.json")):
        month = snap_path.stem  # YYYY-MM
        snap = json.loads(snap_path.read_text())
        trips = []
        for e in snap.get("edges", []):
            trips.append(
                {
                    "sub": e.get("source", ""),
                    "sub_type": "UNK",
                    "rel": e.get("rel", "Related To"),
                    "rel_category": e.get("rel_cat", "UNK"),
                    "obj": e.get("target", ""),
                    "obj_type": "UNK",
                    "w": float(e.get("weight") or 1),
                }
            )
        # Recover node types (edges don't carry them; nodes do).
        types = {n["id"]: n.get("type", "UNK") for n in snap.get("nodes", [])}
        for t in trips:
            t["sub_type"] = types.get(t["sub"], "UNK")
            t["obj_type"] = types.get(t["obj"], "UNK")
        if not trips:
            continue
        rows.append(
            {
                "date": f"{month}-15",
                "title": f"STOXX {month} aggregate",
                "ticker": "",
                "url": f"stoxx://{month}",
                "text": "",
                "summary": "",
                "output_triplets": repr(trips),
            }
        )

    df = pd.DataFrame(rows)
    df.to_csv(args.out, index=False)
    print(f"Wrote {args.out}: {len(df)} month-rows")
    print("months:", [r["url"].split("//")[1] for r in rows])


if __name__ == "__main__":
    main()
