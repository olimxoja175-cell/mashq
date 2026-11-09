"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { "X-WV-Request": "1" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: opts.signal, cache: "no-store" });
  if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized?.();
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = data && typeof data === "object" && "detail" in data ? (data as { detail: unknown }).detail : res.statusText;
    const msg = Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).join("; ") : String(detail);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export function wsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // In development the API runs on :8000; in production the reverse proxy serves /ws on the same origin.
  // "localhost" may resolve to IPv6 ::1 where another service can own :8000, so pin IPv4 in dev.
  const host = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
  return location.port === "3000" ? `${proto}://${host}:8000` : `${proto}://${location.host}`;
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", ...opts });
}
