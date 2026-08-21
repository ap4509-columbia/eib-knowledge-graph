// Industry (sector) inference for the live factor corpora.
//
// The scraper's snapshots don't tag entities with a sector — but every
// cluster in these corpora is a star of entities extracted from one story
// about one watchlist company, and each watchlist spans a handful of
// sectors. So we infer: find the watchlist company mentioned inside a
// connected cluster, and the whole cluster inherits its sector. Clusters
// with no watchlist match fall into "Other".
//
// Keyword lists mirror scraper/watchlists/<corpus>.yaml — keep them in
// sync when a watchlist changes. Single-token keywords match whole words
// inside the entity name (so "eni" hits "ENI.MI" but not "Enix");
// multi-word keywords match as substrings. Ultra-short ambiguous tickers
// (V, T, GE, BA, KO, PG, GS, CAT, DIS) are deliberately omitted — their
// company names carry the match instead.

import type { Snapshot } from "@/lib/api/types";

export const OTHER_SECTOR = "Other";

interface SectorConfig {
  order: string[];
  keywords: Record<string, string[]>;
  defaultChecked: string[];
}

const SECTOR_CONFIGS: Record<string, SectorConfig> = {
  stoxx_600_factors: {
    order: [
      "Pharma",
      "Tech",
      "Banks & financials",
      "Industrials & autos",
      "Energy",
      "Consumer & luxury",
      OTHER_SECTOR,
    ],
    defaultChecked: ["Pharma"],
    keywords: {
      Pharma: [
        "novo nordisk", "novo-b",
        "roche", "rog",
        "novartis", "novn",
        "sanofi",
        "astrazeneca", "azn",
      ],
      Tech: [
        "sap",
        "asml",
        "adyen",
        "capgemini",
        "stmicroelectronics", "stmpa", "stm",
      ],
      "Banks & financials": [
        "bnp", "paribas",
        "hsbc", "hsba",
        "santander",
        "deutsche bank", "dbk",
        "ing groep", "inga",
      ],
      "Industrials & autos": [
        "siemens", "sie",
        "airbus",
        "schneider",
        "volkswagen", "vow3",
        "mercedes", "mercedes-benz", "mbg", "daimler",
      ],
      Energy: [
        "shell", "shel",
        "totalenergies", "total energies", "tte",
        "bp",
        "equinor", "eqnr",
        "eni",
      ],
      "Consumer & luxury": [
        "nestle", "nestlé", "nesn",
        "lvmh", "louis vuitton", "moet", "moët",
        "unilever", "ulvr",
        "inditex", "zara", "itx",
        "l'oréal", "l'oreal", "loreal", "oréal", "oreal",
      ],
    },
  },
  sp100_factors: {
    order: [
      "Tech",
      "Financials",
      "Healthcare",
      "Consumer",
      "Energy & industrials",
      "Communications & media",
      OTHER_SECTOR,
    ],
    defaultChecked: ["Tech"],
    keywords: {
      Tech: [
        "apple", "aapl",
        "microsoft", "msft",
        "nvidia", "nvda",
        "alphabet", "google", "googl",
        "meta platforms", "meta", "facebook",
        "broadcom", "avgo",
        "advanced micro devices", "amd",
        "adobe", "adbe",
        "salesforce",
        "cisco", "csco",
        "ibm", "international business machines",
        "intel", "intc",
        "intuit", "intu",
        "servicenow",
        "oracle", "orcl",
        "palantir", "pltr",
        "qualcomm", "qcom",
        "texas instruments", "txn",
        "accenture", "acn",
      ],
      Financials: [
        "jpmorgan", "jp morgan", "jpm", "chase",
        "bank of america", "bac",
        "goldman sachs", "goldman",
        "berkshire", "brk",
        "visa",
        "mastercard",
        "american express", "amex", "axp",
        "blackrock", "blk",
        "bny mellon", "bank of new york", "bny",
        "citigroup", "citi", "citibank",
        "capital one",
        "metlife",
        "morgan stanley",
        "schwab", "schw",
        "u.s. bancorp", "us bancorp",
        "wells fargo", "wfc",
        "american international group", "aig",
        "simon property", "spg",
        "paypal", "pypl",
      ],
      Healthcare: [
        "eli lilly", "lilly", "lly",
        "unitedhealth", "unh",
        "johnson & johnson", "johnson and johnson", "jnj",
        "pfizer", "pfe",
        "merck", "mrk",
        "abbvie", "abbv",
        "abbott", "abt",
        "amgen", "amgn",
        "bristol-myers", "bristol myers", "bmy",
        "cvs",
        "danaher", "dhr",
        "gilead", "gild",
        "intuitive surgical", "isrg",
        "medtronic", "mdt",
        "thermo fisher",
      ],
      Consumer: [
        "amazon", "amzn",
        "tesla", "tsla",
        "walmart", "wmt",
        "procter", "gamble",
        "coca-cola", "coca cola",
        "mcdonald", "mcdonald's", "mcd",
        "booking holdings", "bkng",
        "colgate",
        "costco",
        "home depot",
        "lowe's", "lowes",
        "mondelez", "mdlz",
        "altria",
        "nike", "nke",
        "pepsico", "pepsi",
        "philip morris",
        "starbucks", "sbux",
        "tgt",
        "general motors", "gm",
      ],
      "Energy & industrials": [
        "exxon", "exxonmobil", "xom",
        "chevron", "cvx",
        "conocophillips",
        "caterpillar",
        "boeing",
        "general electric", "ge aerospace",
        "ge vernova", "gev",
        "deere",
        "emerson", "emr",
        "fedex", "fdx",
        "general dynamics",
        "honeywell",
        "lockheed", "lmt",
        "3m", "mmm",
        "raytheon", "rtx",
        "union pacific", "unp",
        "united parcel",
        "duke energy",
        "nextera",
        "southern company",
        "linde",
      ],
      "Communications & media": [
        "netflix", "nflx",
        "disney",
        "at&t",
        "charter communications", "chtr",
        "comcast", "cmcsa",
        "t-mobile", "tmobile", "tmus",
        "verizon",
        "american tower",
      ],
    },
  },
};

/** Sources with a watchlist-backed sector map (Industry filter enabled). */
export const SECTOR_SOURCE_IDS = new Set(Object.keys(SECTOR_CONFIGS));

export function getSectorOrder(sourceId: string): string[] {
  return SECTOR_CONFIGS[sourceId]?.order ?? [OTHER_SECTOR];
}

export function getDefaultCheckedSectors(sourceId: string): Set<string> {
  return new Set(SECTOR_CONFIGS[sourceId]?.defaultChecked ?? []);
}

// Both sides are normalized to space-joined tokens so punctuation never
// blocks a match: "Coca-Cola", "Lowe's", and "Bristol-Myers Squibb" all
// hit their keywords. Multi-token keywords match on token boundaries
// (padded substring), single tokens on whole-word membership.
function normalizeTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
}

function matchSector(entityId: string, config: SectorConfig): string | null {
  const tokens = normalizeTokens(entityId);
  const words = new Set(tokens);
  const padded = ` ${tokens.join(" ")} `;
  for (const [sector, keywords] of Object.entries(config.keywords)) {
    for (const kw of keywords) {
      const kwTokens = normalizeTokens(kw);
      if (kwTokens.length > 1) {
        if (padded.includes(` ${kwTokens.join(" ")} `)) return sector;
      } else if (kwTokens.length === 1 && words.has(kwTokens[0])) {
        return sector;
      }
    }
  }
  return null;
}

/**
 * Infer a sector for every node in the snapshot: connected components via
 * union-find, each component takes the majority sector of its directly
 * matched members (ties broken by the source's sector order), unmatched
 * components get OTHER_SECTOR.
 */
export function inferNodeSectors(
  snapshot: Snapshot,
  sourceId: string
): Map<string, string> {
  const config = SECTOR_CONFIGS[sourceId];
  const result = new Map<string, string>();
  if (!config) {
    for (const n of snapshot.nodes) result.set(n.id, OTHER_SECTOR);
    return result;
  }

  const ids = snapshot.nodes.map((n) => n.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const parent = ids.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const e of snapshot.edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a !== undefined && b !== undefined) union(a, b);
  }

  const votes = new Map<number, Map<string, number>>();
  ids.forEach((id, i) => {
    const sector = matchSector(id, config);
    if (!sector) return;
    const root = find(i);
    const v = votes.get(root) ?? new Map<string, number>();
    v.set(sector, (v.get(sector) ?? 0) + 1);
    votes.set(root, v);
  });

  const componentSector = new Map<number, string>();
  for (const [root, v] of votes) {
    let best = OTHER_SECTOR;
    let bestCount = -1;
    for (const sector of config.order) {
      const c = v.get(sector) ?? 0;
      if (c > bestCount) {
        best = sector;
        bestCount = c;
      }
    }
    componentSector.set(root, best);
  }

  ids.forEach((id, i) => {
    result.set(id, componentSector.get(find(i)) ?? OTHER_SECTOR);
  });
  return result;
}
