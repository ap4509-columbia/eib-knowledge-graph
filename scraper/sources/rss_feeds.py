"""Generic RSS reader — for ECB, EIB, ESMA, Bank of England, and any other public feed."""

from __future__ import annotations

import feedparser

from .base import Article, parse_rss_date


def fetch(feed_url: str, ticker: str = "", limit: int = 50) -> list[Article]:
    feed = feedparser.parse(feed_url)
    source_name = feed.feed.get("title", "rss") if hasattr(feed, "feed") else "rss"
    out: list[Article] = []
    for entry in feed.entries[:limit]:
        out.append(
            Article(
                date=parse_rss_date(getattr(entry, "published", None)),
                title=entry.title,
                ticker=ticker,
                url=entry.link,
                source=source_name,
                text=getattr(entry, "summary", "") or entry.title,
            )
        )
    return out
