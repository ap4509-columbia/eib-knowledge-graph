// Typed fetch wrappers around the FastAPI backend.

import { API_BASE_URL } from "@/lib/config";
import { getApiKey } from "@/lib/settings";
import type { Index, Snapshot } from "./types";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function fetchIndex(): Promise<Index> {
  const res = await fetch(`${API_BASE_URL}/api/index`, { cache: "no-store" });
  return jsonOrThrow<Index>(res);
}

export async function fetchSnapshot(month: string): Promise<Snapshot> {
  const res = await fetch(`${API_BASE_URL}/api/snapshot/${month}`, {
    cache: "no-store",
  });
  return jsonOrThrow<Snapshot>(res);
}

export async function runPipeline(): Promise<Index> {
  const res = await fetch(`${API_BASE_URL}/api/run`, {
    method: "POST",
    cache: "no-store",
  });
  return jsonOrThrow<Index>(res);
}

export interface ChatRequest {
  query: string;
  month?: string;
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["X-Gemini-Api-Key"] = apiKey;

  const res = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
    cache: "no-store",
  });
  return jsonOrThrow<ChatResponse>(res);
}

export { ApiError };
