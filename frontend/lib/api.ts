const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "dbw-token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  // extra query params
  params?: Record<string, string | number | undefined | null>;
};

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const url = new URL(API_URL + path, window.location.origin);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const token = getToken();
  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Read the body first: a 401 usually carries the reason, and throwing before
  // reading it discarded exactly the message the user needed.
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (res.status === 401) {
    const onLogin = typeof window !== "undefined" && window.location.pathname.startsWith("/login");
    // A 401 while signing in means the credentials were rejected — say what the
    // server said. A 401 anywhere else means the session is gone, so clear it and
    // send them to sign in.
    if (!onLogin) {
      clearToken();
      if (typeof window !== "undefined") window.location.href = "/login";
    }
    throw new ApiError(401, data?.error ?? (onLogin
      ? "Sign in failed. Check your mobile number and password."
      : "Your session has expired. Please sign in again."));
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "Something went wrong. Please try again.");
  }
  return data as T;
}
