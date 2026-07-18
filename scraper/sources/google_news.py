"""Google News RSS — free, unlimited, no auth."""

from __future__ import annotations

import urllib.parse
import feedparser

from .base import Article, parse_rss_date


def fetch(ticker: str, extra_terms: str = "stock", region: str = "US", lang: str = "en", limit: int = 25) -> list[Article]:
    """Fetch recent news for a ticker via Google News RSS.

    `region` follows Google's gl= codes (US, DE, FR, GB, ...); `lang` follows hl=.
    """
    query = urllib.parse.quote(f"{ticker} {extra_terms}".strip())
    url = f"https://news.google.com/rss/search?q={query}&hl={lang}&gl={region}&ceid={region}:{lang}"
    feed = feedparser.parse(url)

    out: list[Article] = []
    for entry in feed.entries[:limit]:
        source_name = "google_news"
        if hasattr(entry, "source") and getattr(entry.source, "title", None):
            source_name = f"google_news:{entry.source.title}"
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
