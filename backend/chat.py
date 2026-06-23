"""
Chat backend: retrieve relevant article summaries from the source CSV and
ask an LLM (Gemini or OpenAI) to answer the analyst's question grounded in them.

Provider + model + key can come from (in priority order):
  1. Per-request HTTP headers (X-LLM-Provider / X-LLM-Model / X-LLM-Api-Key)
     supplied by the frontend Settings dialog
  2. Env vars in backend/.env (LLM_PROVIDER, LLM_MODEL, GEMINI_API_KEY, OPENAI_API_KEY)
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from google import genai  # noqa: E402
from google.genai import types as genai_types  # noqa: E402
from google.genai import errors as genai_errors  # noqa: E402

from runner import SOURCE_CSV  # noqa: E402


# ── Exceptions ─────────────────────────────────────────────────────────


class ChatNotConfigured(Exception):
    pass


class ChatRateLimited(Exception):
    def __init__(self, message: str, retry_after_seconds: Optional[float] = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


# ── Article cache ──────────────────────────────────────────────────────


_ARTICLES_DF: Optional[pd.DataFrame] = None


def _load_articles() -> pd.DataFrame:
    global _ARTICLES_DF
    if _ARTICLES_DF is not None:
        return _ARTICLES_DF
    df = pd.read_csv(SOURCE_CSV, low_memory=False)
    df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)
    df = df.dropna(subset=["date"])
    df["month"] = df["date"].dt.to_period("M").astype(str)
    df["summary"] = df["summary"].fillna("")
    df["text"] = df["text"].fillna("")
    df["title"] = df["title"].fillna("")
    df["ticker"] = df["ticker"].fillna("")
    _ARTICLES_DF = df
    return df


# ── Retrieval ──────────────────────────────────────────────────────────


def _looks_like_ticker(s: str) -> bool:
    return s.isupper() and 1 < len(s) <= 5


def retrieve_articles(
    query: str,
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
    focused_entity: Optional[str] = None,
    max_articles: int = 8,
) -> pd.DataFrame:
    df = _load_articles()
    if month_from:
        df = df[df["month"] >= month_from]
    if month_to:
        df = df[df["month"] <= month_to]

    keywords = [k.strip() for k in query.lower().split() if len(k.strip()) > 2]
    if focused_entity:
        ent = focused_entity.strip()
        if _looks_like_ticker(ent):
            df = df[df["ticker"] == ent]
        else:
            keywords.append(ent.lower())

    if not keywords:
        return df.sort_values("date", ascending=False).head(max_articles)

    title_lower = df["title"].str.lower()
    summary_lower = df["summary"].str.lower()
    score = pd.Series(0, index=df.index)
    for kw in keywords:
        score = score + title_lower.str.contains(kw, regex=False).astype(int) * 2
        score = score + summary_lower.str.contains(kw, regex=False).astype(int)

    df = df.assign(_score=score)
    df = df[df["_score"] > 0].sort_values(
        ["_score", "date"], ascending=[False, False]
    )
    return df.head(max_articles)


# ── Prompt construction ────────────────────────────────────────────────


_SYSTEM_PROMPT = """You are a research assistant helping a risk analyst at the European Investment Bank.
The analyst is looking at a knowledge graph built from financial news articles, and asks you questions about what they see.

You have access to summaries of the most relevant articles for their query (provided below).
Use them to answer concisely and accurately. When you reference a specific story, cite the article title in *italics*.
If the provided articles don't contain enough information to answer, say so honestly — do not make things up.

Keep answers compact: 2–6 sentences for simple questions, a short bulleted list for comparative ones. No throat-clearing."""


def _build_user_message(
    query: str,
    articles: pd.DataFrame,
    month_from: Optional[str],
    month_to: Optional[str],
    focused_entity: Optional[str],
) -> str:
    context_lines = []
    if month_from and month_to:
        if month_from == month_to:
            context_lines.append(f"- Month in view: **{month_from}**")
        else:
            context_lines.append(
                f"- Month range: **{month_from}** → **{month_to}**"
            )
    elif month_from:
        context_lines.append(f"- Months from **{month_from}** onward")
    elif month_to:
        context_lines.append(f"- Months up to **{month_to}**")
    if focused_entity:
        context_lines.append(f"- Focused entity: **{focused_entity}**")
    context_block = (
        "Context from the graph the analyst is viewing:\n"
        + "\n".join(context_lines)
        + "\n\n"
        if context_lines
        else ""
    )

    if len(articles) == 0:
        articles_block = "_No matching articles found._\n"
    else:
        articles_block = "Relevant articles:\n\n"
        for _, row in articles.iterrows():
            articles_block += (
                f"### {row['title']}\n"
                f"_{row['date'].date()} · {row['ticker']}_\n"
                f"{row['summary'][:600]}\n\n"
            )

    return f"{context_block}{articles_block}\n---\n\nAnalyst question:\n{query}"


def _sources_from_articles(articles: pd.DataFrame) -> list[dict]:
    return [
        {
            "title": row["title"],
            "ticker": row["ticker"],
            "date": str(row["date"].date()),
            "url": row.get("url", ""),
        }
        for _, row in articles.iterrows()
    ]


# ── Provider: Gemini ───────────────────────────────────────────────────


_DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"


def _chat_gemini(
    query: str,
    articles: pd.DataFrame,
    user_message: str,
    *,
    model: Optional[str],
    api_key: Optional[str],
) -> dict:
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ChatNotConfigured(
            "No Gemini API key. Add one in Settings or set GEMINI_API_KEY in backend/.env. "
            "Get a free key at https://aistudio.google.com/apikey"
        )
    model_name = model or os.environ.get("LLM_MODEL") or _DEFAULT_GEMINI_MODEL

    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=user_message,
            config=genai_types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
            ),
        )
    except genai_errors.ClientError as exc:
        status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        if status == 429:
            retry = None
            m = re.search(r"retry in ([\d.]+)s", str(exc), re.IGNORECASE)
            if m:
                retry = float(m.group(1))
            raise ChatRateLimited(
                "Gemini's free-tier quota is exhausted right now. "
                + (
                    f"Try again in ~{int(retry) + 1}s."
                    if retry
                    else "Wait a moment and try again."
                ),
                retry_after_seconds=retry,
            ) from exc
        raise

    return {
        "answer": (response.text or "").strip(),
        "sources": _sources_from_articles(articles),
        "model": model_name,
        "provider": "gemini",
    }


# ── Provider: OpenAI ───────────────────────────────────────────────────


_DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


def _chat_openai(
    query: str,
    articles: pd.DataFrame,
    user_message: str,
    *,
    model: Optional[str],
    api_key: Optional[str],
) -> dict:
    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ChatNotConfigured(
            "No OpenAI API key. Add one in Settings or set OPENAI_API_KEY in backend/.env. "
            "Get one at https://platform.openai.com/api-keys"
        )
    model_name = model or os.environ.get("LLM_MODEL") or _DEFAULT_OPENAI_MODEL

    from openai import OpenAI, RateLimitError, AuthenticationError, APIError

    client = OpenAI(api_key=api_key)
    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        )
    except RateLimitError as exc:
        raise ChatRateLimited(
            "OpenAI rate limit reached. Wait a moment and try again."
        ) from exc
    except AuthenticationError as exc:
        raise ChatNotConfigured("OpenAI key looks invalid. Check Settings.") from exc
    except APIError as exc:
        # Surface a clean message for any other OpenAI-side error.
        raise RuntimeError(f"OpenAI API error: {exc}") from exc

    answer = (response.choices[0].message.content or "").strip()
    return {
        "answer": answer,
        "sources": _sources_from_articles(articles),
        "model": model_name,
        "provider": "openai",
    }


# ── Public dispatcher ──────────────────────────────────────────────────


def chat(
    query: str,
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
    focused_entity: Optional[str] = None,
    *,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict:
    """Run a single chat turn. Dispatches to the right provider."""
    provider = (provider or os.environ.get("LLM_PROVIDER") or "gemini").lower()
    articles = retrieve_articles(query, month_from, month_to, focused_entity)
    user_message = _build_user_message(
        query, articles, month_from, month_to, focused_entity
    )

    if provider == "gemini":
        return _chat_gemini(
            query, articles, user_message, model=model, api_key=api_key
        )
    if provider == "openai":
        return _chat_openai(
            query, articles, user_message, model=model, api_key=api_key
        )
    raise ChatNotConfigured(
        f"Unknown LLM provider: {provider!r}. Use 'gemini' or 'openai'."
    )
