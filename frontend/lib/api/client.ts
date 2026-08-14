// Data access layer.
//
// The deployed app is static: snapshots, index, and the per-month article
// corpus all live as JSON files under /data/* and are served by Vercel's
// CDN. The Python backend is no longer in the request path at runtime.
//
// Two endpoints — runPipeline() and sendChat() — still hit a backend if
// NEXT_PUBLIC_API_BASE_URL is set. They're only used when Alexandra runs
// the FastAPI server locally; the deployed UI hides their entry points.

import { API_BASE_URL } from "@/lib/config";
import { getApiKey, getModel, getProvider } from "@/lib/settings";
import type {
  FactorsFile,
  Index,
  PredictionsFile,
  Snapshot,
  SourcesFile,
} from "./types";

// True when this build has a backend wired in. Driven by the env var so the
// Vercel static build flips it off and local dev flips it on.
export const HAS_BACKEND =
  typeof process !== "undefined" &&
  !!process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

const NGROK_BYPASS = { "ngrok-skip-browser-warning": "1" } as const;

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
      else if (body) detail = JSON.stringify(body);
    } catch {
      try {
        detail = (await res.text()) || detail;
      } catch {
        /* keep status text */
      }
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

// ── Static data fetches (work everywhere) ──────────────────────────────
// All per-corpus fetches now live under /data/sources/<sourceId>/*.
// The sources.json index at the top level lists which corpora exist.

function sourceBase(sourceId: string): string {
  return `/data/sources/${sourceId}`;
}

// Cache the source index and the predictions per source — both are read
// often (predictions view re-renders on every month change).
let SOURCES_CACHE: SourcesFile | null = null;
const PREDICTIONS_CACHE = new Map<string, PredictionsFile>();

export async function fetchSources(): Promise<SourcesFile> {
  if (SOURCES_CACHE) return SOURCES_CACHE;
  // cache: no-store — sources.json changes when we add/remove corpora and
  // we've been repeatedly bitten by browsers holding onto a stale copy.
  // File is tiny so bypassing the cache costs ~nothing.
  const res = await fetch(`/data/sources.json`, { cache: "no-store" });
  SOURCES_CACHE = await jsonOrThrow<SourcesFile>(res);
  return SOURCES_CACHE;
}

export async function fetchIndex(sourceId: string): Promise<Index> {
  const res = await fetch(`${sourceBase(sourceId)}/index.json`, {
    cache: "no-store",
  });
  return jsonOrThrow<Index>(res);
}

export async function fetchSnapshot(
  sourceId: string,
  month: string
): Promise<Snapshot> {
  const res = await fetch(`${sourceBase(sourceId)}/snapshots/${month}.json`, {
    cache: "no-store",
  });
  return jsonOrThrow<Snapshot>(res);
}

export async function fetchPredictions(
  sourceId: string
): Promise<PredictionsFile> {
  const cached = PREDICTIONS_CACHE.get(sourceId);
  if (cached) return cached;
  const res = await fetch(`${sourceBase(sourceId)}/predictions.json`, {
    cache: "no-store",
  });
  const data = await jsonOrThrow<PredictionsFile>(res);
  PREDICTIONS_CACHE.set(sourceId, data);
  return data;
}

// Factor-model bundle. factors/latest.json holds the most recent daily
// rollup produced by scraper/run_daily_factors.py. Cached per source.
const FACTORS_CACHE = new Map<string, FactorsFile>();

export async function fetchFactorsLatest(
  sourceId: string
): Promise<FactorsFile> {
  const cached = FACTORS_CACHE.get(sourceId);
  if (cached) return cached;
  const res = await fetch(`${sourceBase(sourceId)}/factors/latest.json`, {
    cache: "no-store",
  });
  const data = await jsonOrThrow<FactorsFile>(res);
  FACTORS_CACHE.set(sourceId, data);
  return data;
}

// ── Article search (browser-side) ──────────────────────────────────────

export interface SearchRequest {
  sourceId: string;
  query: string;
  month?: string;
  month_from?: string;
  month_to?: string;
  focused_entity?: string;
  limit?: number;
}

export interface ArticleResult {
  title: string;
  ticker: string;
  date: string;
  url: string;
  summary: string;
  score: number;
}

export interface SearchResponse {
  results: ArticleResult[];
}

interface BundledArticle {
  date: string;
  title: string;
  ticker: string;
  url: string;
  summary: string;
}

// Cache fetched month files so widening the range / running multiple
// searches doesn't re-download. Keyed by "<sourceId>:<month>".
const ARTICLE_CACHE = new Map<string, BundledArticle[]>();

async function loadArticles(
  sourceId: string,
  month: string
): Promise<BundledArticle[]> {
  const key = `${sourceId}:${month}`;
  const cached = ARTICLE_CACHE.get(key);
  if (cached) return cached;
  try {
    const res = await fetch(`${sourceBase(sourceId)}/articles/${month}.json`, {
      cache: "no-store",
    });
    if (!res.ok) {
      ARTICLE_CACHE.set(key, []);
      return [];
    }
    const data = (await res.json()) as BundledArticle[];
    ARTICLE_CACHE.set(key, data);
    return data;
  } catch {
    ARTICLE_CACHE.set(key, []);
    return [];
  }
}

function monthsInRange(from?: string, to?: string, all?: string[]): string[] {
  if (!all) return [];
  if (!from && !to) return all;
  return all.filter((m) => (!from || m >= from) && (!to || m <= to));
}

function looksLikeTicker(s: string): boolean {
  return s === s.toUpperCase() && s.length > 1 && s.length <= 5;
}

// Mirrors `retrieve_articles` in backend/chat.py: title hits × 2 + summary
// hits × 1. Keeps the same ranking behavior.
function scoreArticle(
  article: BundledArticle,
  keywords: string[]
): number {
  if (!keywords.length) return 1;
  const title = article.title.toLowerCase();
  const summary = article.summary.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    if (title.includes(k)) score += 2;
    if (summary.includes(k)) score += 1;
  }
  return score;
}

export async function searchArticles(
  req: SearchRequest
): Promise<SearchResponse> {
  // We need the full month list to handle "all months" (no range).
  let allMonths: string[] = [];
  try {
    const index = await fetchIndex(req.sourceId);
    allMonths = index.months ?? [];
  } catch {
    allMonths = [];
  }

  const monthFrom = req.month_from ?? req.month;
  const monthTo = req.month_to ?? req.month;
  const months = monthsInRange(monthFrom, monthTo, allMonths);

  // Fetch all relevant month corpora in parallel; concatenate.
  const corpora = await Promise.all(
    months.map((m) => loadArticles(req.sourceId, m))
  );
  let articles = corpora.flat();

  // Focused-entity filter — same heuristic as the backend.
  const keywords = req.query
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (req.focused_entity) {
    const ent = req.focused_entity.trim();
    if (looksLikeTicker(ent)) {
      articles = articles.filter((a) => a.ticker === ent);
    } else {
      keywords.push(ent.toLowerCase());
    }
  }

  // Score + sort.
  const scored = articles
    .map((a) => ({ a, s: scoreArticle(a, keywords) }))
    .filter((x) => (keywords.length === 0 ? true : x.s > 0));

  scored.sort((x, y) => {
    if (y.s !== x.s) return y.s - x.s;
    // Tie-break by date desc, mirroring the backend.
    return y.a.date.localeCompare(x.a.date);
  });

  const limit = req.limit ?? 20;
  const results: ArticleResult[] = scored.slice(0, limit).map(({ a, s }) => ({
    title: a.title,
    ticker: a.ticker,
    date: a.date,
    url: a.url,
    summary: a.summary,
    score: s,
  }));

  return { results };
}

// ── Backend-only endpoints (no-op when HAS_BACKEND is false) ───────────

export async function runPipeline(): Promise<Index> {
  if (!HAS_BACKEND) {
    throw new ApiError(
      501,
      "No backend configured — set NEXT_PUBLIC_API_BASE_URL to use /api/run."
    );
  }
  const res = await fetch(`${API_BASE_URL}/api/run`, {
    method: "POST",
    cache: "no-store",
    headers: { ...NGROK_BYPASS },
  });
  return jsonOrThrow<Index>(res);
}

export interface ChatRequest {
  query: string;
  month?: string;
  month_from?: string;
  month_to?: string;
  focused_entity?: string;
}

export interface ChatSource {
  title: string;
  ticker: string;
  date: string;
  url: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  model: string;
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  if (!HAS_BACKEND) {
    throw new ApiError(
      501,
      "No backend configured — set NEXT_PUBLIC_API_BASE_URL to use /api/chat."
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...NGROK_BYPASS,
  };
  const provider = getProvider();
  const model = getModel(provider);
  const apiKey = getApiKey(provider);
  if (provider) headers["X-LLM-Provider"] = provider;
  if (model) headers["X-LLM-Model"] = model;
  if (apiKey) headers["X-LLM-Api-Key"] = apiKey;

  const res = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
    cache: "no-store",
  });
  return jsonOrThrow<ChatResponse>(res);
}

export { ApiError };
