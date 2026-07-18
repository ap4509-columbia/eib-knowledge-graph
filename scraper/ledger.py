"""URL-hash dedup ledger. Committed to the repo so the next scheduled run
knows what it has already seen. Grows linearly with unique articles ingested."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


class Ledger:
    def __init__(self, path: Path):
        self.path = path
        self._seen: set[str] = set()
        self._last_updated: str | None = None
        self._load()

    def _load(self):
        if self.path.exists():
            with open(self.path) as f:
                data = json.load(f)
            self._seen = set(data.get("seen", []))
            self._last_updated = data.get("last_updated")

    @staticmethod
    def _hash(url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]

    def contains(self, url: str) -> bool:
        return self._hash(url) in self._seen

    def add(self, url: str):
        self._seen.add(self._hash(url))

    def add_all(self, urls: Iterable[str]):
        for u in urls:
            self.add(u)

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(
                {
                    "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "count": len(self._seen),
                    "seen": sorted(self._seen),
                },
                f,
                indent=2,
            )

    def __len__(self):
        return len(self._seen)
