"""Pluggable LLM backend for the factor-model pipeline.

Every LLM call in the live pipeline (enriched extraction, judge+refine,
entity canonicalization) goes through generate() so the backend is a
deployment choice, not a code change:

    EIBKG_LLM_BACKEND=gemini   (default) — Gemini via GEMINI_API_KEY.
                                Used by the GitHub Actions cron (cloud
                                runners have no GPU).
    EIBKG_LLM_BACKEND=ollama   — local model via the Ollama HTTP API.
                                Used on the GPU VM: zero API cost.

    EIBKG_LLM_MODEL            — override the backend's default model
                                (gemini-2.5-flash / qwen2.5:14b).
    OLLAMA_HOST                — Ollama endpoint, default
                                http://localhost:11434.

Both paths raise on hard failure; callers keep their own fail-open
handling (a flaky call must never lose a day's data).
"""

from __future__ import annotations

import os
import time

BACKEND = os.environ.get("EIBKG_LLM_BACKEND", "gemini").lower()
_DEFAULT_MODELS = {"gemini": "gemini-2.5-flash", "ollama": "qwen2.5:14b"}
MODEL = os.environ.get("EIBKG_LLM_MODEL", _DEFAULT_MODELS.get(BACKEND, "gemini-2.5-flash"))

_gemini_client = None


def _generate_gemini(prompt: str, api_key: str | None) -> str:
    global _gemini_client
    from google import genai
    from google.genai import errors as genai_errors

    if _gemini_client is None:
        api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set — cannot call Gemini.")
        _gemini_client = genai.Client(api_key=api_key)
    for attempt in (0, 1):
        try:
            resp = _gemini_client.models.generate_content(model=MODEL, contents=prompt)
            return resp.text or ""
        except genai_errors.APIError:
            if attempt == 0:
                time.sleep(1.5)
                continue
            raise
    return ""


def _generate_ollama(prompt: str) -> str:
    import requests

    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    for attempt in (0, 1):
        try:
            r = requests.post(
                f"{host}/api/generate",
                json={"model": MODEL, "prompt": prompt, "stream": False},
                timeout=300,
            )
            r.raise_for_status()
            return r.json().get("response", "") or ""
        except requests.RequestException:
            if attempt == 0:
                time.sleep(2)
                continue
            raise
    return ""


def generate(prompt: str, api_key: str | None = None) -> str:
    """One LLM completion via the configured backend."""
    if BACKEND == "ollama":
        return _generate_ollama(prompt)
    return _generate_gemini(prompt, api_key)


def describe() -> str:
    return f"{BACKEND}:{MODEL}"
