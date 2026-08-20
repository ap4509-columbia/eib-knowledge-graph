"""Enriched-triplet extraction — used by the factor-model daily runner.

Distinct from the existing extraction.py (which parses the old 6-tuple
format). This module calls Gemini with the enriched prompt and returns
JSON dicts carrying sentiment/materiality/event_type per triplet — the
fields the factor computation needs.

Never touches extraction.py; that module remains as-is for the team's
existing pipeline.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Optional

from scraper import llm
from scraper.sources.base import Article


PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "triplet_extraction_enriched.txt"
_PROMPT_TEMPLATE: Optional[str] = None


def _load_prompt_template() -> str:
    global _PROMPT_TEMPLATE
    if _PROMPT_TEMPLATE is None:
        _PROMPT_TEMPLATE = PROMPT_PATH.read_text()
    return _PROMPT_TEMPLATE


def _build_prompt(article: Article) -> str:
    body = article.text or article.title or ""
    if article.title and article.title not in body:
        body = f"{article.title}\n\n{body}"
    return _load_prompt_template().replace("{input_text_}", body)


def _sanitize(raw: str) -> list[dict]:
    """Parse Gemini output → list of triplet-dicts.

    Robust to leading/trailing markdown fences and prose. Returns an empty
    list on any parse failure — caller treats empty as "model returned
    nothing usable" rather than raising."""
    if not raw:
        return []
    # Strip common markdown fences
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.MULTILINE)

    # Model sometimes prepends "OUTPUT:" or similar — strip anything before
    # the first '[' and after the last ']'.
    lb, rb = cleaned.find("["), cleaned.rfind("]")
    if lb == -1 or rb == -1 or rb < lb:
        return []
    cleaned = cleaned[lb : rb + 1]

    try:
        parsed = json.loads(cleaned)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []

    out: list[dict] = []
    for t in parsed:
        if not isinstance(t, dict):
            continue
        # Require the core structural fields
        if not all(k in t and isinstance(t[k], str) for k in ("sub", "sub_type", "rel", "obj", "obj_type")):
            continue
        # Coerce numerics
        s = t.get("sentiment")
        t["sentiment"] = float(s) if isinstance(s, (int, float)) else 0.0
        m = t.get("materiality_usd")
        t["materiality_usd"] = float(m) if isinstance(m, (int, float)) and m > 0 else None
        # Normalise event_type; default OTHER
        ev = t.get("event_type")
        t["event_type"] = ev if isinstance(ev, str) and ev.strip() else "OTHER"
        # rel_category default UNK if the model dropped it
        rc = t.get("rel_category")
        t["rel_category"] = rc if isinstance(rc, str) and rc.strip() else "UNK"
        out.append(t)
    return out


def extract_enriched(
    articles: list[Article],
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """Run enriched extraction over articles. Returns {url: [triplet-dicts]}.

    Retries once on Gemini transient errors. Logs per-article progress to
    stdout so the GitHub Actions log tail is useful mid-run."""
    print(f"LLM backend: {llm.describe()}")
    results: dict[str, list[dict]] = {}

    for i, art in enumerate(articles, start=1):
        prompt = _build_prompt(art)
        triplets: list[dict] = []
        try:
            triplets = _sanitize(llm.generate(prompt, api_key))
        except Exception as e:
            print(f"  [{i:4}/{len(articles):4}] llm error, giving up: {e}")

        results[art.url] = triplets
        if i % 10 == 0 or i == len(articles):
            print(f"  [{i:4}/{len(articles):4}] {art.ticker or '-':10s}  {len(triplets)} triplets")

    return results
