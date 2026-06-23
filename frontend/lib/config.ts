// Centralized config. Defaults to localhost; override via NEXT_PUBLIC_API_BASE_URL.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
