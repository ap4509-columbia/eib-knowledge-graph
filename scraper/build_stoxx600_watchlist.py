"""Build (or refresh) the STOXX Europe 600 watchlist by scraping the current
constituent list from Wikipedia. Keeps the tickers current across index
rebalancings without any human intervention.

Adds Yahoo Finance exchange suffixes based on each constituent's country of
listing, so `yahoo_finance` source calls route to the right exchange.

Run whenever you want to refresh:
    python scraper/build_stoxx600_watchlist.py

Overwrites scraper/watchlists/stoxx_europe_600.yaml.
"""

from __future__ import annotations

from io import StringIO
from pathlib import Path
from datetime import date

import pandas as pd
import requests

WIKI_URL = "https://en.wikipedia.org/wiki/STOXX_Europe_600"
OUTPUT = Path(__file__).parent / "watchlists" / "stoxx_europe_600.yaml"

# Yahoo requires no UA; Wikipedia rejects urllib default — spoof a browser.
UA = "Mozilla/5.0 (compatible; eib-kg-scraper/1.0; +https://github.com/ap4509-columbia/eib-knowledge-graph)"

# Country → Yahoo Finance exchange suffix. Covers every STOXX 600 listing venue.
# Reference: https://help.yahoo.com/kb/SLN2310.html
COUNTRY_TO_SUFFIX = {
    "United Kingdom": ".L",
    "Ireland":        ".IR",      # some dual-list to LSE; keep .IR as primary guess
    "Germany":        ".DE",
    "France":         ".PA",
    "Netherlands":    ".AS",
    "Belgium":        ".BR",
    "Luxembourg":     ".LU",
    "Italy":          ".MI",
    "Spain":          ".MC",
    "Portugal":       ".LS",
    "Switzerland":    ".SW",
    "Austria":        ".VI",
    "Sweden":         ".ST",
    "Denmark":        ".CO",
    "Finland":        ".HE",
    "Norway":         ".OL",
    "Iceland":        ".IC",
    "Poland":         ".WA",
    "Czech Republic": ".PR",
    "Czechia":        ".PR",
    "Greece":         ".AT",
    "Hungary":        ".BD",
}


def yahoo_ticker(bare: str, country: str) -> str:
    """Return the Yahoo Finance form of a ticker given its country."""
    suffix = COUNTRY_TO_SUFFIX.get(country.strip(), "")
    if not suffix:
        # Unknown country — fall back to the bare ticker (may still work if US-listed ADR)
        return bare
    # Some Wikipedia tickers already carry a suffix; keep them as-is
    if "." in bare:
        return bare
    return f"{bare}{suffix}"


def main():
    resp = requests.get(WIKI_URL, headers={"User-Agent": UA}, timeout=30)
    resp.raise_for_status()
    tables = pd.read_html(StringIO(resp.text))

    # Find the table with Ticker + Country columns
    table = None
    for t in tables:
        cols = [str(c).strip() for c in t.columns]
        if "Ticker" in cols and "Country" in cols:
            t.columns = cols
            table = t
            break
    if table is None:
        raise SystemExit("Could not find constituent table on Wikipedia.")

    # Clean
    table = table[["Ticker", "Company", "ICB Sector", "Country"]].dropna(subset=["Ticker", "Country"])
    table["Ticker"] = table["Ticker"].astype(str).str.strip()
    table["Company"] = table["Company"].astype(str).str.strip()
    table["Country"] = table["Country"].astype(str).str.strip()
    table["ICB Sector"] = table["ICB Sector"].astype(str).str.strip()
    table = table[table["Ticker"].str.match(r"^[A-Z0-9.\-]{1,15}$")]
    table = table.drop_duplicates(subset=["Ticker"]).reset_index(drop=True)

    # Build Yahoo-suffixed tickers
    table["yahoo_ticker"] = table.apply(lambda r: yahoo_ticker(r["Ticker"], r["Country"]), axis=1)

    # Sort by country then ticker so the YAML is scannable
    table = table.sort_values(["Country", "yahoo_ticker"]).reset_index(drop=True)

    print(f"Fetched {len(table)} STOXX Europe 600 constituents across {table['Country'].nunique()} countries")
    print("  countries:", ", ".join(sorted(table["Country"].unique())))

    lines = [
        "corpus: stoxx_europe_600",
        f"description: STOXX Europe 600 constituents (auto-generated from Wikipedia on {date.today().isoformat()}). Yahoo Finance suffixes kept on tickers for exchange disambiguation, but google_news is the only source in use.",
        "",
        "sources:",
        "  - google_news",
        "",
        f"# {len(table)} tickers sorted by country, then ticker.",
        "# Regenerate with: python scraper/build_stoxx600_watchlist.py",
        "tickers:",
    ]

    current_country = None
    for _, row in table.iterrows():
        if row["Country"] != current_country:
            current_country = row["Country"]
            lines.append(f"  # ── {current_country} ──")
        # Comment includes company + sector for scannability
        comment = f"{row['Company']} · {row['ICB Sector']}"
        lines.append(f"  - {row['yahoo_ticker']:<12}  # {comment}")

    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
