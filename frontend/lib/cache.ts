"use client";

import { api } from "./api";

/**
 * Tiny in-memory GET cache for near-static master/options data, so combobox
 * options aren't re-downloaded on every navigation (matters on slow internet).
 * Short TTL keeps it fresh enough; call bustCache() after a master mutation.
 */
interface Entry {
  at: number;
  data: unknown;
}

const store = new Map<string, Entry>();
const TTL = 60_000; // 60s

export async function cachedGet<T>(path: string, ttl = TTL): Promise<T> {
  const hit = store.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  const data = await api<T>(path);
  store.set(path, { at: Date.now(), data });
  return data;
}

/** Drop cached entries. No prefix = clear all; call after adding/editing a master. */
export function bustCache(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
