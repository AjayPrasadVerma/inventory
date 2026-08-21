"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn, roleLabel } from "@/lib/utils";
import { Icon } from "./icons";

/**
 * Read the theme straight off <html class="dark"> instead of copying it into
 * state. The class is external mutable state — the boot script in the layout and
 * the command palette both write it — so a local copy goes stale the moment
 * something else toggles. useSyncExternalStore is the supported way to subscribe.
 */
function useDarkClass(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const ob = new MutationObserver(onChange);
      ob.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => ob.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false, // server render: the boot script has not run yet
  );
}

export function UserMenu({ name, role, onLogout }: { name?: string; role?: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const dark = useDarkClass();
  const ref = useRef<HTMLDivElement>(null);
  const initials = (name ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("dbw-theme", next ? "dark" : "light");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-surface-2"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-tint text-xs font-semibold text-primary">
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[9rem] truncate text-sm font-medium text-ink">{name}</span>
          <span className="block text-xs text-muted">{roleLabel(role)}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("text-muted transition-transform", open && "rotate-180")} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-md)]">
          <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-tint text-sm font-semibold text-primary">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{name}</p>
              <p className="truncate text-xs text-muted">{roleLabel(role)}</p>
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          <MenuItem
            icon={dark ? <Icon.Sun /> : <Icon.Moon />}
            label={dark ? "Light mode" : "Dark mode"}
            onClick={toggleTheme}
            trailing={
              <span className={cn("flex h-5 w-9 items-center rounded-full px-0.5 transition-colors", dark ? "bg-primary justify-end" : "bg-border-strong justify-start")}>
                <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
              </span>
            }
          />

          <div className="my-1 h-px bg-border" />

          <MenuItem
            icon={<Icon.Logout />}
            label="Sign out"
            danger
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, trailing, danger }: { icon: React.ReactNode; label: string; onClick: () => void; trailing?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
        danger ? "text-[color:var(--danger)] hover:bg-[color:var(--danger-tint)]" : "text-ink hover:bg-surface-2",
      )}
    >
      <span className={cn("shrink-0", danger ? "" : "text-muted")}>{icon}</span>
      <span className="flex-1">{label}</span>
      {trailing}
    </button>
  );
}
