"""Shared Article dataclass used by every source module."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional
from email.utils import parsedate_to_datetime


@dataclass
class Article:
    date: str          # ISO-8601 UTC date, e.g. "2026-07-15"
    title: str
    ticker: str        # may be empty for regulator/general feeds
    url: str
    source: str        # human-readable source name ("google_news", "ecb", ...)
    text: str          # blurb/summary — the fuller body is fetched by Gemini's prompt

    def to_dict(self) -> dict:
        return asdict(self)


def parse_rss_date(raw: Optional[str]) -> str:
    """Coerce an RSS-style date string into ISO YYYY-MM-DD UTC. Falls back to today."""
    if not raw:
        return datetime.now(timezone.utc).date().isoformat()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    except (TypeError, ValueError):
        return datetime.now(timezone.utc).date().isoformat()
