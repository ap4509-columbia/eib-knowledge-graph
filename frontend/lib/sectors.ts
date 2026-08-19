// Industry (sector) inference for the STOXX Europe 600 (Live) corpus.
//
// The scraper's snapshots don't tag entities with a sector — but every
// cluster in this corpus is a star of entities extracted from one story
// about one watchlist company, and the watchlist is 30 companies across
// six sectors. So we infer: find the watchlist company mentioned inside a
// connected cluster, and the whole cluster inherits its sector. Clusters
// with no watchlist match fall into "Other".
//
// Keyword lists mirror scraper/watchlists/stoxx_600_factors.yaml — keep
// the two in sync when the watchlist changes.

import type { Snapshot } from "@/lib/api/types";

/** Sources this inference applies to. Others get no Industry filter. */
export const SECTOR_SOURCE_IDS = new Set(["stoxx_600_factors"]);

export const OTHER_SECTOR = "Other";

// Single-token keywords match whole words inside the entity name (so "eni"
// hits "ENI.MI" but not "Enix"); multi-word keywords match as substrings.
const SECTOR_KEYWORDS: Record<string, string[]> = {
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
};

/** Stable display order for the filter UI. */
export const SECTOR_ORDER = [
  "Pharma",
  "Tech",
  "Banks & financials",
  "Industrials & autos",
  "Energy",
  "Consumer & luxury",
  OTHER_SECTOR,
];

function matchSector(entityId: string): string | null {
  const lower = entityId.toLowerCase();
  const words = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    for (const kw of keywords) {
      if (kw.includes(" ")) {
        if (lower.includes(kw)) return sector;
      } else if (words.has(kw)) {
        return sector;
      }
    }
  }
  return null;
}

/**
 * Infer a sector for every node in the snapshot: connected components via
 * union-find, each component takes the majority sector of its directly
 * matched members (ties broken by SECTOR_ORDER), unmatched components get
 * OTHER_SECTOR.
 */
export function inferNodeSectors(snapshot: Snapshot): Map<string, string> {
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

  // Per-component sector votes from directly matched entity names.
  const votes = new Map<number, Map<string, number>>();
  ids.forEach((id, i) => {
    const sector = matchSector(id);
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
    for (const sector of SECTOR_ORDER) {
      const c = v.get(sector) ?? 0;
      if (c > bestCount) {
        best = sector;
        bestCount = c;
      }
    }
    componentSector.set(root, best);
  }

  const result = new Map<string, string>();
  ids.forEach((id, i) => {
    result.set(id, componentSector.get(find(i)) ?? OTHER_SECTOR);
  });
  return result;
}
