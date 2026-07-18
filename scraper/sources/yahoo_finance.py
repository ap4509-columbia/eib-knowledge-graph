"""Yahoo Finance per-ticker news RSS. Works for US, London, XETRA, Paris, Milan, Madrid tickers."""

from __future__ import annotations

import feedparser

from .base import Article, parse_rss_date


def fetch(ticker: str, limit: int = 25) -> list[Article]:
    url = f"https://finance.yahoo.com/rss/headline?s={ticker}"
    feed = feedparser.parse(url)
    out: list[Article] = []
    for entry in feed.entries[:limit]:
        out.append(
            Article(
                date=parse_rss_date(getattr(entry, "published", None)),
                title=entry.title,
                ticker=ticker,
                url=entry.link,
                source="yahoo_finance",
                text=getattr(entry, "summary", "") or entry.title,
            )
        )
    return out
