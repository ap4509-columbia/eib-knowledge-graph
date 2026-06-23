// Typed fetch wrappers around the FastAPI backend.

import { API_BASE_URL } from "@/lib/config";
import { getApiKey, getModel, getProvider } from "@/lib/settings";
import type { Index, Snapshot } from "./types";

// ngrok's free tier shows an HTML interstitial on first browser visit; this
// header tells ngrok to skip it for our XHR/fetch requests.
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
    // Try to extract the `detail` field FastAPI uses; fall back to text.
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") {
        detail = body.detail;
      } else if (body) {
        detail = JSON.stringify(body);
      }
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

export async function fetchIndex(): Promise<Index> {
  const res = await fetch(`${API_BASE_URL}/api/index`, {
    cache: "no-store",
    headers: { ...NGROK_BYPASS },
  });
  return jsonOrThrow<Index>(res);
}

export async function fetchSnapshot(month: string): Promise<Snapshot> {
  const res = await fetch(`${API_BASE_URL}/api/snapshot/${month}`, {
    cache: "no-store",
    headers: { ...NGROK_BYPASS },
  });
  return jsonOrThrow<Snapshot>(res);
}

export async function runPipeline(): Promise<Index> {
  const res = await fetch(`${API_BASE_URL}/api/run`, {
    method: "POST",
    cache: "no-store",
    headers: { ...NGROK_BYPASS },
  });
  return jsonOrThrow<Index>(res);
}

export interface ChatRequest {
  query: string;
  /** Legacy single-month context; superseded by month_from/month_to. */
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

export interface SearchRequest {
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

export async function searchArticles(
  req: SearchRequest
): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...NGROK_BYPASS },
    body: JSON.stringify(req),
    cache: "no-store",
  });
  return jsonOrThrow<SearchResponse>(res);
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
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
