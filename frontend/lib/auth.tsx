"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, clearSession, getRefreshToken, getToken, setSession } from "./api";

export type Role = "owner" | "staff";
export interface AuthUser {
  id: number;
  name: string;
  role: Role;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Whether we are waiting on /auth/me is known before the first paint: with no
  // token there is nothing to wait for. Deciding it here rather than correcting
  // it from an effect avoids a render pass that shows a spinner for no reason.
  const [loading, setLoading] = useState(() => !!getToken());

  // On a reload the access token is usually expired now that it is short-lived.
  // That is no longer a reason to sign out: api() refreshes and repeats this
  // call, so only a session the server actually refuses lands in the catch.
  useEffect(() => {
    if (!getToken()) return;
    api<{ user: AuthUser }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => clearSession())
      .finally(() => setLoading(false));
  }, []);

  async function login(mobile: string, password: string) {
    const r = await api<{ token: string; accessToken?: string; refreshToken: string; user: AuthUser }>(
      "/auth/login",
      { method: "POST", body: { mobile, password } },
    );
    // accessToken is the name the API means; token is the alias it still sends
    // for clients written before refresh existed.
    setSession(r.accessToken ?? r.token, r.refreshToken);
    setUser(r.user);
  }

  /**
   * Signing out now has a server side: the refresh token outlives the page, so
   * dropping it locally would leave a session the API would still renew.
   *
   * The call is awaited but never allowed to fail the sign-out — the tokens are
   * discarded either way, and a user who asked to leave must not be kept on the
   * page by a dropped request. A refresh token left behind expires on its own.
   */
  async function logout() {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      await api("/auth/logout", { method: "POST", body: { refreshToken } }).catch(() => {});
    }
    clearSession();
    setUser(null);
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
