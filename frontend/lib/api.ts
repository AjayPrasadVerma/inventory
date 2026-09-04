const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "dbw-token";
const REFRESH_KEY = "dbw-refresh";

/** Paths that must never trigger a refresh: /auth/refresh would recurse, and a
 *  401 from login or logout means what it says rather than "token expired". */
const AUTH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout"];

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}
/** Store a fresh pair. Both are written together — a token without its refresh
 *  token is a session that ends at the first expiry, which is the bug this whole
 *  file exists to remove. */
export function setSession(token: string, refreshToken: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
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

function send(path: string, opts: Options): Promise<Response> {
  const url = new URL(API_URL + path, window.location.origin);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  // Read inside send, not once per api() call: a retry after a refresh has to
  // pick up the new token rather than repeat the expired one.
  const token = getToken();
  return fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/**
 * One refresh at a time, shared by everyone waiting on it.
 *
 * This is the part that has to be right. Refresh tokens rotate — using one spends
 * it — so if a page that fired four requests let all four refresh on their 401s,
 * the first would succeed and the other three would present a token that had just
 * been spent. The API reads a spent token as a replay, which is theft as far as it
 * can tell, and ends **every** session that user has. Four parallel refreshes
 * would sign the shop out of its own app.
 *
 * So the first caller starts the refresh and the rest await the same promise.
 */
let inFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  inFlight ??= runRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(API_URL + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    // accessToken is the name the API means; token is the old alias it still
    // sends. Either is fine, but a reply carrying neither is not a session.
    const next: unknown = data?.accessToken ?? data?.token;
    if (typeof next !== "string" || typeof data?.refreshToken !== "string") return false;
    setSession(next, data.refreshToken);
    return true;
  } catch {
    // The link dropped mid-refresh. Report failure without deciding anything
    // else; the caller's 401 handling takes it from here.
    return false;
  }
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  let res = await send(path, opts);

  // An expired access token is now an ordinary event rather than the end of the
  // session: refresh once and repeat the request. Only once — if the second try
  // is also refused, the problem is not the token's age.
  if (
    res.status === 401 &&
    !AUTH_PATHS.some((p) => path.startsWith(p)) &&
    getRefreshToken() &&
    (await refreshSession())
  ) {
    res = await send(path, opts);
  }

  // Read the body first: a 401 usually carries the reason, and throwing before
  // reading it discarded exactly the message the user needed.
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (res.status === 401) {
    const onLogin = typeof window !== "undefined" && window.location.pathname.startsWith("/login");
    // A 401 while signing in means the credentials were rejected — say what the
    // server said. A 401 anywhere else now means refreshing did not help either:
    // the session is genuinely over, so clear it and send them to sign in.
    if (!onLogin) {
      clearSession();
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
