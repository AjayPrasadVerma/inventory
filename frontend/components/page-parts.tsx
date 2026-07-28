"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./icons";

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 10 && !onPageSize) return null;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <span className="text-sm text-muted">
        Showing <span className="font-medium text-ink">{from}–{to}</span> of {total}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-sm text-ink outline-none focus:border-primary"
            aria-label="Rows per page"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <span className="px-1 text-sm text-muted">
          Page {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * Renders the page's title/subtitle/back + actions into the top bar (via portals),
 * so pages don't spend vertical space on their own header. Renders nothing inline.
 */
export function PageHeader({
  title,
  subtitle,
  count,
  actions,
  backHref,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  actions?: React.ReactNode;
  backHref?: string;
}) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal targets in the shell exist only after mount
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const titleSlot = typeof document !== "undefined" ? document.getElementById("topbar-title") : null;
  const actionsSlot = typeof document !== "undefined" ? document.getElementById("topbar-actions") : null;

  return (
    <>
      {titleSlot && createPortal(
        <div className="flex min-w-0 items-center gap-2.5">
          {backHref && (
            <Link href={backHref} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-ink">
              <Icon.ArrowLeft />
            </Link>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold leading-tight tracking-tight text-ink">{title}</h1>
              {count !== undefined && (
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">{count}</span>
              )}
            </div>
            {subtitle && <p className="truncate text-xs leading-tight text-muted">{subtitle}</p>}
          </div>
        </div>,
        titleSlot,
      )}
      {actionsSlot && actions && createPortal(actions, actionsSlot)}
    </>
  );
}

type StatTone = "default" | "success" | "warning" | "danger" | "accent";
const toneRing: Record<StatTone, string> = {
  default: "text-primary bg-primary-tint",
  success: "text-[color:var(--success)] bg-[color:var(--success-tint)]",
  warning: "text-[color:var(--warning)] bg-[color:var(--warning-tint)]",
  danger: "text-[color:var(--danger)] bg-[color:var(--danger-tint)]",
  accent: "text-[color:var(--accent)] bg-[color:var(--accent-tint)]",
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: StatTone;
  href?: string;
}) {
  const body = (
    <>
      {icon && (
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", toneRing[tone])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate text-lg font-semibold text-ink">{value}</p>
        {hint && <p className="text-[11px] text-muted">{hint}</p>}
      </div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="soft-card flex items-center gap-3 p-3 transition-colors hover:border-border-strong hover:bg-surface-2">
        {body}
      </Link>
    );
  }
  return <div className="soft-card flex items-center gap-3 p-3">{body}</div>;
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** A rounded search input with a leading icon, sized for toolbars. */
export function SearchBar({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <div className="relative min-w-52 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink shadow-xs placeholder:text-muted focus:border-primary outline-none"
        />
      </div>
      {children}
    </div>
  );
}
