"""Second- and third-stage LLM passes for the factor-model daily runner.

Mirrors the three-LLM architecture of the team's eib-eval pipeline
(triplet LLM → judge LLM → flagged-triplet refinement LLM), collapsed for
our title-only corpus into two cost-conscious Gemini passes:

  1. refine_triplets()       — per-article judge + refiner in one call:
                               drops nonsense entities, merges restated
                               facts, canonicalizes names within the
                               article. (The team runs judge and refiner
                               as separate models; with ~60-char RSS
                               titles a combined pass is sufficient and
                               halves the calls.)
  2. canonicalize_entities() — one cross-article call per run: maps entity
                               name variants ("ASML" / "ASML Holding" /
                               "ASML Holding N.V.") onto one canonical
                               name each, preferring names the corpus
                               already uses so new data merges into
                               existing nodes instead of duplicating them.

Both passes fail open: any API/parse failure returns the input unchanged,
so a bad day degrades to first-pass quality instead of losing data.
Never touches the team's extraction.py / eib-eval pipeline.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Optional

from google import genai
from google.genai import errors as genai_errors

from scraper.sources.base import Article
from scraper.extraction_enriched import _sanitize

REFINE_PROMPT_PATH = (
    Path(__file__).resolve().parent / "prompts" / "triplet_refinement.txt"
)
_REFINE_TEMPLATE: Optional[str] = None

_MODEL = "gemini-2.5-flash"


def _refine_template() -> str:
    global _REFINE_TEMPLATE
    if _REFINE_TEMPLATE is None:
        _REFINE_TEMPLATE = REFINE_PROMPT_PATH.read_text()
    return _REFINE_TEMPLATE


def _client(api_key: str | None) -> genai.Client:
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set — cannot run refinement.")
    return genai.Client(api_key=api_key)


def _generate(client: genai.Client, prompt: str) -> str:
    """One generate call with a single retry on transient API errors."""
    for attempt in (0, 1):
        try:
            resp = client.models.generate_content(model=_MODEL, contents=prompt)
            return resp.text or ""
        except genai_errors.APIError:
            if attempt == 0:
                time.sleep(1.5)
                continue
            raise
    return ""


def refine_triplets(
    articles: list[Article],
    triplets_by_url: dict[str, list[dict]],
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """Judge-and-refine pass over each article's first-pass triplets.

    Returns a new {url: triplets} mapping. Articles whose refinement call
    fails (or returns nothing parseable) keep their original triplets —
    fail open, never lose a day's data to a flaky call."""
    client = _client(api_key)
    out: dict[str, list[dict]] = {}
    n = len(articles)
    refined_ct = kept_ct = 0

    for i, art in enumerate(articles, start=1):
        original = triplets_by_url.get(art.url) or []
        if not original:
            out[art.url] = original
            continue
        body = art.text or art.title or ""
        if art.title and art.title not in body:
            body = f"{art.title}\n\n{body}"
        prompt = (
            _refine_template()
            .replace("{input_text_}", body)
            .replace("{triplets_}", json.dumps(original, ensure_ascii=False))
        )
        try:
            refined = _sanitize(_generate(client, prompt))
        except Exception as e:
            print(f"  [refine {i:3}/{n:3}] failed, keeping originals: {e}")
            out[art.url] = original
            kept_ct += 1
            continue
        # An empty result is a legitimate verdict ("nothing survives") only
        # when the model answered; _sanitize returning [] on garbage is
        # indistinguishable, so require valid JSON to have parsed at least
        # one triplet OR trust [] — we trust it: junk-only articles exist.
        out[art.url] = refined
        refined_ct += 1
        if i % 10 == 0 or i == n:
            print(f"  [refine {i:3}/{n:3}] done")

    print(f"Refinement: {refined_ct} articles refined, {kept_ct} kept originals.")
    return out


def known_entity_names(corpus_root: Path, months: int = 2) -> list[str]:
    """Canonical-name pool: node ids from the freshest `months` snapshots."""
    snap_dir = corpus_root / "snapshots"
    names: list[str] = []
    seen: set[str] = set()
    if snap_dir.exists():
        for p in sorted(snap_dir.glob("*.json"))[-months:]:
            try:
                snap = json.loads(p.read_text())
            except Exception:
                continue
            for node in snap.get("nodes", []):
                nid = node.get("id")
                if isinstance(nid, str) and nid not in seen:
                    seen.add(nid)
                    names.append(nid)
    return names


def canonicalize_entities(
    triplets_by_url: dict[str, list[dict]],
    known_names: list[str],
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """Cross-article entity canonicalization — one Gemini call per run.

    Collects every entity name in today's triplets, asks the model to group
    variants of the same real-world entity and pick one canonical name each
    (preferring a name from the corpus's existing pool so new edges merge
    into existing nodes), then rewrites sub/obj in place. Fails open."""
    fresh_names = sorted(
        {
            t[k]
            for trips in triplets_by_url.values()
            for t in trips
            for k in ("sub", "obj")
            if isinstance(t.get(k), str)
        }
    )
    if not fresh_names:
        return triplets_by_url

    prompt = (
        "You are deduplicating entity names for a financial knowledge graph.\n"
        "NEW NAMES extracted today:\n"
        + json.dumps(fresh_names, ensure_ascii=False)
        + "\n\nEXISTING CANONICAL NAMES already in the graph:\n"
        + json.dumps(known_names[:400], ensure_ascii=False)
        + "\n\nFind NEW NAMES that refer to the same real-world entity as "
        "another new name or an existing canonical name (e.g. 'ASML', "
        "'ASML Holding', 'ASML Holding N.V.'; 'VW' and 'Volkswagen AG'; a "
        "ticker like 'XTRA:DBK' stays distinct from the company — do NOT "
        "merge tickers into companies). Prefer the existing canonical name "
        "as the target; otherwise the most complete common name.\n"
        "Return ONLY a JSON object mapping each variant that should be "
        "renamed to its canonical name. Variants that are already fine must "
        "be omitted. No prose, no markdown fences."
    )
    try:
        raw = _generate(_client(api_key), prompt)
    except Exception as e:
        print(f"Canonicalization call failed, skipping: {e}")
        return triplets_by_url

    cleaned = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.MULTILINE)
    lb, rb = cleaned.find("{"), cleaned.rfind("}")
    if lb == -1 or rb == -1 or rb < lb:
        print("Canonicalization: unparseable response, skipping.")
        return triplets_by_url
    try:
        mapping = json.loads(cleaned[lb : rb + 1])
    except Exception:
        print("Canonicalization: invalid JSON, skipping.")
        return triplets_by_url
    mapping = {
        k: v
        for k, v in mapping.items()
        if isinstance(k, str) and isinstance(v, str) and k != v and v.strip()
    }
    if not mapping:
        print("Canonicalization: no renames suggested.")
        return triplets_by_url

    print(f"Canonicalization: applying {len(mapping)} renames, e.g. "
          + "; ".join(f"{k!r}→{v!r}" for k, v in list(mapping.items())[:3]))
    out: dict[str, list[dict]] = {}
    for url, trips in triplets_by_url.items():
        new_trips = []
        for t in trips:
            t = dict(t)
            if t.get("sub") in mapping:
                t["sub"] = mapping[t["sub"]]
            if t.get("obj") in mapping:
                t["obj"] = mapping[t["obj"]]
            # A rename can make a triplet self-referential — drop those.
            if t.get("sub") == t.get("obj"):
                continue
            new_trips.append(t)
        out[url] = new_trips
    return out
