"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icons";
import { Spinner } from "@/components/ui/misc";

// ─── Command palette (⌘K) ────────────────────────────────────────────────────
// One overlay for "find anything" and "go anywhere": server search hits across
// vendors / karigars / materials / products / bills / jobs, plus a static set of
// navigate-and-create commands. Search and commands share the same input and the
// same keyboard loop, so they live in one component rather than two modals.

const TRIGGER_EVENT = "dbw:open-command-palette";

/** Open the palette from anywhere — e.g. the navbar's search button. */
export function openCommandPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TRIGGER_EVENT));
}

type HitType = "vendor" | "karigar" | "item" | "product" | "purchase" | "job";

interface Hit {
  type: HitType;
  id: number;
  title: string;
  subtitle: string | null;
  matched: string | null;
  stock: string | null;
  href: string;
}
interface Group { key: string; label: string; hits: Hit[] }

interface Row {
  key: string;
  section: string;
  icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode;
  tone: string;
  title: string;
  subtitle?: string | null;
  /** What this row IS — the same name can exist as both a vendor and a karigar,
   *  so the row has to say so itself rather than relying on the group header. */
  kind?: string;
  badge?: string | null;
  /** On-hand for materials/products — shown instead of the match badge. */
  stock?: string | null;
  href?: string;
  action?: () => void;
}

const HIT_ICON: Record<HitType, (p: React.SVGProps<SVGSVGElement>) => React.ReactNode> = {
  vendor: Icon.Vendor, karigar: Icon.Karigar, item: Icon.Item,
  product: Icon.Product, purchase: Icon.Purchase, job: Icon.Job,
};
const HIT_TONE: Record<HitType, string> = {
  vendor: "bg-primary-tint text-primary",
  karigar: "bg-[color:var(--warning-tint)] text-[color:var(--warning)]",
  item: "bg-[color:var(--accent-tint)] text-[color:var(--accent)]",
  product: "bg-[color:var(--success-tint)] text-[color:var(--success)]",
  purchase: "bg-primary-tint text-primary",
  job: "bg-[color:var(--warning-tint)] text-[color:var(--warning)]",
};
const NEUTRAL = "bg-surface-2 text-muted";

const HIT_KIND: Record<HitType, string> = {
  vendor: "Vendor", karigar: "Karigar", item: "Material",
  product: "Product", purchase: "Purchase", job: "Job",
};

export function CommandPalette() {
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  // Each query gets a number; only the newest may write results. Without this a
  // slow response for "abc" landing after a fast "xyz" replaced the visible hits
  // with the wrong term's.
  const queryIdRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setTerm("");
    setGroups([]);
    setSelected(0);
  }, []);

  // On close: discard any response still in flight, then hand focus back to
  // whatever opened the palette. Both live in an effect rather than in close(),
  // so no function reachable from the render path ever reads a ref.
  useEffect(() => {
    if (open) return;
    queryIdRef.current += 1;
    lastFocusRef.current?.focus();
  }, [open]);

  // ⌘K / Ctrl-K from anywhere, plus the imperative trigger from the navbar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Already open: keep the original opener, or Esc would return focus to
        // the palette's own input, i.e. to nothing.
        if (!open) lastFocusRef.current = document.activeElement as HTMLElement;
        setOpen(true);
      }
    };
    const onTrigger = () => {
      if (!open) lastFocusRef.current = document.activeElement as HTMLElement;
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener(TRIGGER_EVENT, onTrigger);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(TRIGGER_EVENT, onTrigger);
    };
  }, [open]);

  // Lock the page behind the overlay and put the caret in the box.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => { document.body.style.overflow = ""; window.clearTimeout(t); };
  }, [open]);

  const runSearch = useCallback(async (q: string) => {
    const id = ++queryIdRef.current;
    if (q.trim().length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api<{ data: { groups: Group[] } }>(`/search?q=${encodeURIComponent(q.trim())}`);
      if (id !== queryIdRef.current) return; // a newer query has since been issued
      setGroups(res.data.groups);
    } catch {
      if (id === queryIdRef.current) setGroups([]);
    } finally {
      if (id === queryIdRef.current) setLoading(false);
    }
  }, []);

  // Debounced so a query doesn't fire on every keystroke.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { runSearch(term); }, 200);
    return () => window.clearTimeout(t);
  }, [term, open, runSearch]);

  /** Static commands — kept local so "new vend" still surfaces "New vendor". */
  const commands = useMemo<Row[]>(() => {
    const toggleTheme = () => {
      const root = document.documentElement;
      const next = !root.classList.contains("dark");
      root.classList.toggle("dark", next);
      localStorage.setItem("dbw-theme", next ? "dark" : "light");
    };
    const nav = (title: string, href: string, icon: Row["icon"], keywords = "") =>
      ({ key: `go:${href}`, section: "Go to", icon, tone: NEUTRAL, title, subtitle: keywords || null, href } as Row);
    const create = (title: string, href: string, subtitle: string) =>
      ({ key: `new:${href}`, section: "Create", icon: Icon.Plus, tone: "bg-primary-tint text-primary", title, subtitle, href } as Row);

    return [
      nav("Dashboard", "/", Icon.Dashboard, "home overview"),
      nav("Vendors", "/vendors", Icon.Vendor, "suppliers accounts purchases"),
      nav("Karigars", "/karigars", Icon.Karigar, "thekedaar jobs"),
      nav("Products", "/products", Icon.Product, "raw material finished goods stock"),
      create("New vendor", "/vendors?new=1", "Add a raw material supplier"),
      create("New karigar", "/karigars?new=1", "Add a thekedaar"),
      create("New product", "/products?new=1", "Raw material or finished goods"),
      { key: "sys:theme", section: "System", icon: Icon.Sun, tone: NEUTRAL, title: "Toggle theme", subtitle: "Switch light / dark", action: toggleTheme },
      { key: "sys:signout", section: "System", icon: Icon.Logout, tone: NEUTRAL, title: "Sign out", subtitle: "End your session", action: logout },
    ];
  }, [logout]);

  /** Flat row list the arrow keys walk through: search hits first, then commands. */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (term.trim().length >= 2) {
      for (const g of groups) {
        for (const h of g.hits) {
          out.push({
            key: `hit:${h.type}:${h.id}`,
            section: g.label,
            icon: HIT_ICON[h.type],
            tone: HIT_TONE[h.type],
            kind: HIT_KIND[h.type],
            title: h.title,
            subtitle: h.stock && h.matched
              ? [h.subtitle, h.matched].filter(Boolean).join(" · ")
              : h.subtitle,
            badge: h.stock ? null : h.matched,
            stock: h.stock,
            href: h.href,
          });
        }
      }
    }
    const t = term.trim().toLowerCase();
    out.push(...commands.filter((c) =>
      !t || `${c.title} ${c.subtitle ?? ""}`.toLowerCase().includes(t)));
    return out;
  }, [groups, commands, term]);

  // Keep the highlight inside the list as results change.
  const activeIndex = Math.min(selected, Math.max(0, rows.length - 1));

  // Keep the highlighted row visible. Done by data-index lookup so the list needs
  // one ref instead of one per row.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activate = useCallback((row: Row) => {
    close();
    if (row.href) router.push(row.href);
    else row.action?.();
  }, [close, router]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (!rows.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown"
        ? (activeIndex + 1) % rows.length
        : (activeIndex - 1 + rows.length) % rows.length;
      setSelected(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) activate(row);
    }
  }

  if (!open) return null;

  let section = "";
  const searching = loading && term.trim().length >= 2;

  return (
    <div
      className="acx-overlay-in fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Search and commands"
    >
      <div className="acx-panel-in w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => { setTerm(e.target.value); setSelected(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search vendors, karigars, materials, products, bill no…"
            aria-label="Search"
            // The API rejects anything longer, which the UI swallowed into a bare
            // "Nothing found" — stop the input there instead.
            maxLength={80}
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={rows[activeIndex] ? `palette-row-${activeIndex}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
          {searching && <Spinner className="h-4 w-4 shrink-0 text-muted" />}
          <button onClick={close} aria-label="Close" className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink">
            Esc
          </button>
        </div>

        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Results and commands"
          className="max-h-[min(60vh,28rem)] overflow-y-auto py-1.5"
        >
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              {searching ? "Searching…" : <>Nothing found for <span className="font-medium text-ink">{term.trim()}</span></>}
            </p>
          ) : (
            rows.map((row, i) => {
              const header = row.section !== section ? row.section : null;
              section = row.section;
              const RowIcon = row.icon;
              return (
                <div key={row.key}>
                  {header && (
                    <p className="px-4 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">{header}</p>
                  )}
                  <button
                    data-idx={i}
                    id={`palette-row-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    onClick={() => activate(row)}
                    onMouseMove={() => setSelected(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                      i === activeIndex ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", row.tone)}>
                      <RowIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{row.title}</span>
                      {(row.kind || row.subtitle) && (
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                          {row.kind && (
                            <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", row.tone)}>
                              {row.kind}
                            </span>
                          )}
                          {row.subtitle && <span className="truncate">{row.subtitle}</span>}
                        </span>
                      )}
                    </span>
                    {row.stock ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                          row.stock.trim().startsWith("-")
                            ? "bg-[color:var(--danger-tint)] text-[color:var(--danger)]"
                            : "bg-[color:var(--success-tint)] text-[color:var(--success)]",
                        )}
                        title="Current stock"
                      >
                        {row.stock}
                      </span>
                    ) : row.badge ? (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">{row.badge}</span>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border bg-surface-2 px-4 py-2 text-[11px] text-muted">
          <span><Key>↑</Key><Key>↓</Key> move</span>
          <span><Key>↵</Key> open</span>
          <span><Key>esc</Key> close</span>
          <span className="ml-auto">{rows.length} result{rows.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1 inline-block min-w-[1.25rem] rounded border border-border bg-surface px-1 py-0.5 text-center text-[10px] font-medium text-ink">
      {children}
    </kbd>
  );
}

/** Navbar affordance — looks like a search field, behaves as the palette's button. */
export function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      aria-label="Open search"
      className="flex h-9 items-center gap-2 rounded-lg bg-white/10 pl-2.5 pr-2 text-sm text-white/60 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/15 hover:text-white/85 sm:w-56 xl:w-72"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
      </svg>
      <span className="hidden flex-1 text-left sm:block">Search anything…</span>
      <kbd className="hidden shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/55 ring-1 ring-inset ring-white/10 sm:block">⌘K</kbd>
    </button>
  );
}
