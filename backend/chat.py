"""
Chat backend: retrieve relevant article summaries from the source CSV and
ask Gemini to answer the analyst's question grounded in them.

API key + model live in backend/.env (gitignored). No key → /api/chat returns
a 503 with a helpful message.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from google import genai  # noqa: E402
from google.genai import types as genai_types  # noqa: E402

from runner import SOURCE_CSV  # noqa: E402


# ── Article cache ──────────────────────────────────────────────────────

_ARTICLES_DF: Optional[pd.DataFrame] = None


def _load_articles() -> pd.DataFrame:
    """Read the source CSV once and cache. Used by retrieval."""
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
    month: Optional[str] = None,
    focused_entity: Optional[str] = None,
    max_articles: int = 8,
) -> pd.DataFrame:
    """
    Return the most relevant articles for the user's query, given their
    current view (month + focused entity).
    """
    df = _load_articles()

    # Optional month filter
    if month:
        df = df[df["month"] == month]

    # Build keyword set from query + focused entity
    keywords = [k.strip() for k in query.lower().split() if len(k.strip()) > 2]
    if focused_entity:
        ent = focused_entity.strip()
        if _looks_like_ticker(ent):
            # Ticker → exact match on the ticker column
            df = df[df["ticker"] == ent]
        else:
            keywords.append(ent.lower())

    if not keywords:
        return df.sort_values("date", ascending=False).head(max_articles)

    # Score = number of keywords matched in title + summary
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
    month: Optional[str],
    focused_entity: Optional[str],
) -> str:
    context_lines = []
    if month:
        context_lines.append(f"- Month in view: **{month}**")
    if focused_entity:
        context_lines.append(f"- Focused entity: **{focused_entity}**")
    context_block = (
        "Context from the graph the analyst is viewing:\n" + "\n".join(context_lines) + "\n\n"
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


# ── Public API ─────────────────────────────────────────────────────────

class ChatNotConfigured(Exception):
    pass


def chat(
    query: str,
    month: Optional[str] = None,
    focused_entity: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict:
    """
    Run a single chat turn. Returns:
        { 'answer': str, 'sources': [{title, ticker, date, url}, ...] }

    `api_key` overrides the env var if provided (lets the frontend supply
    a per-user key via the X-Gemini-Api-Key header).
    """
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ChatNotConfigured(
            "No Gemini API key. Either set GEMINI_API_KEY in backend/.env or "
            "paste a key into Settings in the UI. "
            "Get a free key at https://aistudio.google.com/apikey"
        )
    model_name = os.environ.get("LLM_MODEL", "gemini-2.0-flash")

    client = genai.Client(api_key=api_key)
    articles = retrieve_articles(query, month, focused_entity)
    user_message = _build_user_message(query, articles, month, focused_entity)

    response = client.models.generate_content(
        model=model_name,
        contents=user_message,
        config=genai_types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
        ),
    )
    answer = (response.text or "").strip()

    sources = [
        {
            "title": row["title"],
            "ticker": row["ticker"],
            "date": str(row["date"].date()),
            "url": row.get("url", ""),
        }
        for _, row in articles.iterrows()
    ]
    return {"answer": answer, "sources": sources, "model": model_name}
