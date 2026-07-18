"""
Triplet extraction via Gemini 2.5 Flash.

Reads news articles from the past team's semi-cleaned CSV and produces
one triplet-list per article using Gemini, in the same output format the
past team's downstream pipeline expects.

Reads your API key from backend/.env (already set up).
Uses the past team's prompt template + data loader for a drop-in match.

Usage (from repo root):
    python3 scripts/run_gemini_extraction.py \
        --start-date 2020-01-03 --end-date 2020-01-06 \
        --output outputs/triplets_test.csv

Or just click ▶ Run in VS Code — the defaults do a 4-day / 15-article test run.
"""

from __future__ import annotations

import argparse
import ast
import os
import sys
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from google import genai

# ── Set up paths so we can reach the past team's code + data ──────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = REPO_ROOT.parent.parent
DELIVERABLES = PROJECT_ROOT / "past teams work" / "Deliverables_Spring 2026"

if not DELIVERABLES.exists():
    raise SystemExit(
        f"Cannot find past team's deliverables at:\n  {DELIVERABLES}\n"
        "The extraction script needs their prompt + data loader."
    )

sys.path.insert(0, str(DELIVERABLES))

# Load .env from backend/ where the GEMINI_API_KEY lives
load_dotenv(REPO_ROOT / "backend" / ".env")

# Need to run from the deliverables folder so relative paths inside their
# code (e.g. components/tgp.txt for the prompt template, database/*.csv for
# the source articles) resolve correctly.
os.chdir(DELIVERABLES)

from components.triplet_generator import TripletGenerator  # noqa: E402


# ── Sanitize the model's response into a Python list of tuples ────────────

def sanitize(response_text: str) -> str:
    """Turn Gemini's response into the string form of a Python list."""
    if not response_text:
        return "[]"
    text = response_text.strip()
    # Strip markdown fences the model sometimes wraps around lists
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
    try:
        parsed = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return "[]"
    if not isinstance(parsed, list):
        return "[]"
    return str(parsed)


# ── Main run ──────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start-date", default="2020-01-03",
                    help="First date to include (YYYY-MM-DD). Default: 2020-01-03")
    ap.add_argument("--end-date", default="2020-01-06",
                    help="Last date to include (YYYY-MM-DD). Default: 2020-01-06")
    ap.add_argument("--output", default=str(REPO_ROOT / "outputs" / "gemini_triplets.csv"),
                    help="Where to write the CSV. Default: outputs/gemini_triplets.csv")
    ap.add_argument("--text-column", default="summary", choices=["text", "summary"],
                    help="Which column to feed to the LLM. Default: summary")
    ap.add_argument("--model", default="gemini-2.5-flash",
                    help="Gemini model name. Default: gemini-2.5-flash")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit(
            "GEMINI_API_KEY not found. Make sure backend/.env has:\n"
            "  GEMINI_API_KEY=your_key_here"
        )

    # Load and filter articles using the past team's own loader
    df = TripletGenerator.process_data(
        "semi_cleaned_data",
        text_column_=args.text_column,
        start_date_=args.start_date,
        end_date_=args.end_date,
    )
    print(f"\nLoaded {len(df)} articles for range {args.start_date} → {args.end_date}\n")
    if len(df) == 0:
        return

    df = df.reset_index(drop=True)
    df["output_triplets"] = ""

    client = genai.Client(api_key=api_key)

    out_path = Path(args.output)
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    t_start = time.perf_counter()
    per_article_times = []

    for i in range(len(df)):
        row = df.iloc[i]
        prompt = TripletGenerator.build_prompt(row, args.text_column)
        t0 = time.perf_counter()
        try:
            resp = client.models.generate_content(
                model=args.model,
                contents=prompt,
            )
            triplets = sanitize(resp.text or "")
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i+1}/{len(df)}] ERROR — {exc}")
            triplets = "[]"
        dt = time.perf_counter() - t0
        per_article_times.append(dt)
        df.at[i, "output_triplets"] = triplets

        preview = triplets[:110] + ("…" if len(triplets) > 110 else "")
        print(f"  [{i+1:>3}/{len(df)}] {dt:5.1f}s  {row['ticker']:<8}  {preview}")

    df.to_csv(out_path, index=False)
    total = time.perf_counter() - t_start

    print()
    print(f"✓ Wrote {len(df)} rows to {out_path}")
    print(f"  Total elapsed: {total:.1f}s")
    print(
        f"  Per article: mean {sum(per_article_times) / len(per_article_times):.2f}s, "
        f"min {min(per_article_times):.2f}s, max {max(per_article_times):.2f}s"
    )


if __name__ == "__main__":
    main()
