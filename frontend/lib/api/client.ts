// Typed fetch wrappers around the FastAPI backend.

import { API_BASE_URL } from "@/lib/config";
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

export { ApiError };
