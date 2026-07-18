"""Gemini-based triplet extraction. Self-contained — reads the prompt from
scraper/prompts/triplet_extraction.txt so the pipeline has no dependency on
the past team's folder tree (important for CI runs)."""

from __future__ import annotations

import ast
import os
import time
from pathlib import Path

from google import genai
from google.genai import errors as genai_errors

from .sources.base import Article

_PROMPT_PATH = Path(__file__).parent / "prompts" / "triplet_extraction.txt"
_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def _load_prompt_template() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _build_prompt(article: Article, template: str) -> str:
    body = (article.text or article.title).strip()
    if not body:
        body = article.title
    return template.format_map({"input_text_": body})


def _sanitize(response_text: str) -> list[tuple]:
    """Return a list of well-formed 6-tuples, dropping malformed items."""
    if not response_text:
        return []
    text = response_text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
    try:
        parsed = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return []
    if not isinstance(parsed, list):
        return []
    out: list[tuple] = []
    for t in parsed:
        if isinstance(t, (list, tuple)) and len(t) == 6:
            out.append(tuple(str(x) for x in t))
    return out


def extract_triplets(articles: list[Article], api_key: str | None = None) -> dict[str, list[tuple]]:
    """Run Gemini on each article. Returns {article_url: [triplets]}.
    Empty list means either the model returned nothing usable or the call failed."""
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set — cannot extract triplets.")

    template = _load_prompt_template()
    client = genai.Client(api_key=api_key)
    results: dict[str, list[tuple]] = {}

    for i, article in enumerate(articles, start=1):
        prompt = _build_prompt(article, template)
        try:
            resp = client.models.generate_content(model=_MODEL, contents=prompt)
            triplets = _sanitize(resp.text or "")
        except genai_errors.ClientError as exc:
            status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
            if status == 429:
                # Rate-limited. Back off and retry once.
                print(f"  [!] 429 on article {i}; sleeping 30s and retrying")
                time.sleep(30)
                try:
                    resp = client.models.generate_content(model=_MODEL, contents=prompt)
                    triplets = _sanitize(resp.text or "")
                except Exception as e2:
                    print(f"  [!] retry failed: {e2}")
                    triplets = []
            else:
                print(f"  [!] Gemini error on article {i}: {exc}")
                triplets = []
        except Exception as exc:
            print(f"  [!] unexpected error on article {i}: {exc}")
            triplets = []

        results[article.url] = triplets
        print(f"  [{i:>3}/{len(articles)}] {article.ticker or article.source:<20}  {len(triplets)} triplets")

    return results
