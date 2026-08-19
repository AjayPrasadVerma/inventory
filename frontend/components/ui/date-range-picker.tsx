"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ── local date helpers — all built from local parts so no timezone shift ── */

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }
function toISO(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISO(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function label(iso: string) {
  const d = parseISO(iso);
  return d ? `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : "";
}

/** 6×7 grid of the given month, padded with the neighbouring months' days. */
function monthGrid(year: number, month: number) {
  const start = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, inMonth: d.getMonth() === month };
  });
}

/* ── presets ─────────────────────────────────────────────────────────────── */

export type PresetKey =
  | "today" | "last7" | "last30" | "month" | "lastMonth" | "quarter" | "fy" | "all";

function presetRange(key: PresetKey): { from: string; to: string } {
  const t = today();
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (key) {
    case "today":     return { from: toISO(t), to: toISO(t) };
    case "last7":     return { from: toISO(addDays(t, -6)), to: toISO(t) };
    case "last30":    return { from: toISO(addDays(t, -29)), to: toISO(t) };
    case "month":     return { from: toISO(new Date(y, m, 1)), to: toISO(t) };
    case "lastMonth": return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)) };
    case "quarter":   return { from: toISO(new Date(y, Math.floor(m / 3) * 3, 1)), to: toISO(t) };
    // India's financial year runs April → March, which is what a shop reports on.
    case "fy":        return { from: toISO(new Date(m >= 3 ? y : y - 1, 3, 1)), to: toISO(t) };
    default:          return { from: "", to: "" };
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This financial year" },
  { key: "all", label: "All time" },
];

/* ── component ───────────────────────────────────────────────────────────── */

/**
 * One control for a whole date range: presets on the left, two months to pick
 * from on the right. First click sets the start, second click the end (clicking
 * an earlier day swaps them), then it closes.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  disabled,
  maxToday = true,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
  /** Block future dates — transactional data can't be dated ahead. */
  maxToday?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [picking, setPicking] = React.useState<string | null>(null); // ISO of the first click
  const [hover, setHover] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const base = parseISO(from) ?? today();
  const [viewY, setViewY] = React.useState(base.getFullYear());
  const [viewM, setViewM] = React.useState(base.getMonth());

  /** Anchor the calendar on the current range as it opens, and reset a half-made
   *  selection as it closes. Done here rather than in an effect so no render cascades. */
  function toggle() {
    if (disabled) return;
    if (open) { setOpen(false); setPicking(null); setHover(null); return; }
    const b = parseISO(from) ?? today();
    setViewY(b.getFullYear());
    setViewM(b.getMonth());
    setPicking(null);
    setHover(null);
    setOpen(true);
  }

  const close = React.useCallback(() => {
    setOpen(false);
    setPicking(null);
    setHover(null);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const activePreset = React.useMemo<PresetKey | null>(() => {
    for (const p of PRESETS) {
      const r = presetRange(p.key);
      if (r.from === from && r.to === to) return p.key;
    }
    return null;
  }, [from, to]);

  const max = maxToday ? today() : null;
  const isBlocked = (d: Date) => !!max && d.getTime() > max.getTime();

  function step(months: number) {
    const d = new Date(viewY, viewM + months, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  }

  function clickDay(d: Date) {
    if (isBlocked(d)) return;
    const iso = toISO(d);
    if (!picking) { setPicking(iso); setHover(iso); return; }
    const [a, b] = picking <= iso ? [picking, iso] : [iso, picking];
    onChange(a, b);
    setPicking(null);
    setHover(null);
    setOpen(false);
  }

  /** While picking, preview against the hovered day; otherwise use the saved range. */
  const rangeStart = picking ? (hover && hover < picking ? hover : picking) : from;
  const rangeEnd = picking ? (hover && hover < picking ? picking : hover ?? picking) : to;

  const display = from || to
    ? `${label(from) || "…"}  →  ${label(to) || "…"}`
    : "All time";

  return (
    <div className={cn("relative", className)} ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Date range"
        onClick={toggle}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-ink focus:border-primary",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className={from || to ? "font-medium tabular-nums text-ink" : "text-muted"}>{display}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          role="dialog"
          aria-label="Choose date range"
          className="absolute left-0 z-40 mt-1 flex w-[min(94vw,46rem)] flex-col rounded-xl border border-border bg-surface shadow-[var(--shadow-md)] sm:flex-row"
        >
          {/* Presets */}
          <div className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { const r = presetRange(p.key); onChange(r.from, r.to); setOpen(false); }}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors",
                  activePreset === p.key
                    ? "bg-primary-tint font-medium text-primary"
                    : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Two months */}
          <div className="min-w-0 flex-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex gap-0.5">
                <NavBtn onClick={() => step(-12)} label="Previous year">«</NavBtn>
                <NavBtn onClick={() => step(-1)} label="Previous month">‹</NavBtn>
              </div>
              <div className="flex flex-1 justify-around px-2 text-sm font-medium text-ink">
                <span>{MONTHS[viewM]} {viewY}</span>
                <span className="hidden sm:inline">{MONTHS[(viewM + 1) % 12]} {viewM === 11 ? viewY + 1 : viewY}</span>
              </div>
              <div className="flex gap-0.5">
                <NavBtn onClick={() => step(1)} label="Next month">›</NavBtn>
                <NavBtn onClick={() => step(12)} label="Next year">»</NavBtn>
              </div>
            </div>

            <div className="flex gap-4" onMouseLeave={() => picking && setHover(picking)}>
              <MonthView
                year={viewY} month={viewM}
                rangeStart={rangeStart} rangeEnd={rangeEnd}
                isBlocked={isBlocked} onPick={clickDay} onHover={setHover}
              />
              <div className="hidden min-w-0 flex-1 sm:block">
                <MonthView
                  year={viewM === 11 ? viewY + 1 : viewY} month={(viewM + 1) % 12}
                  rangeStart={rangeStart} rangeEnd={rangeEnd}
                  isBlocked={isBlocked} onPick={clickDay} onHover={setHover}
                />
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs text-muted">
                {picking ? "Now pick the end date" : "Click a start date, then an end date"}
              </span>
              <button
                type="button"
                onClick={() => { onChange("", ""); setPicking(null); setOpen(false); }}
                className="cursor-pointer text-xs font-medium text-muted hover:text-ink"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="h-7 w-7 cursor-pointer rounded-md text-muted hover:bg-surface-2 hover:text-ink">
      {children}
    </button>
  );
}

function MonthView({
  year, month, rangeStart, rangeEnd, isBlocked, onPick, onHover,
}: {
  year: number;
  month: number;
  rangeStart: string;
  rangeEnd: string;
  isBlocked: (d: Date) => boolean;
  onPick: (d: Date) => void;
  onHover: (iso: string) => void;
}) {
  const cells = monthGrid(year, month);
  const t = today();

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted">
        {WEEKDAYS.map((w) => <span key={w} className="py-0.5">{w}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          const iso = toISO(c.date);
          // Neighbouring-month days are drawn greyed so the grid keeps its shape,
          // but they are never part of the band or clickable — otherwise the same
          // date would look selected in two months at once.
          const out = !c.inMonth;
          const blocked = isBlocked(c.date);
          const isStart = !out && !!rangeStart && iso === rangeStart;
          const isEnd = !out && !!rangeEnd && iso === rangeEnd;
          const inRange = !out && !!rangeStart && !!rangeEnd && iso > rangeStart && iso < rangeEnd;
          const edge = isStart || isEnd;

          return (
            <div
              key={i}
              className={cn(
                // No row gap and the tint on the edges too, so the band reads as one
                // continuous sweep instead of a pill per row.
                "flex h-9 items-center justify-center transition-colors",
                (inRange || edge) && "bg-primary-tint",
                isStart && "rounded-l-lg",
                isEnd && "rounded-r-lg",
              )}
            >
              {out ? (
                <span className="text-[13px] tabular-nums text-muted/45">{c.date.getDate()}</span>
              ) : (
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => onPick(c.date)}
                  onMouseEnter={() => onHover(iso)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors",
                    blocked && "pointer-events-none opacity-30",
                    edge
                      ? "bg-primary font-semibold text-primary-fg"
                      : inRange
                        ? "text-primary hover:bg-primary/10"
                        : "text-ink hover:bg-surface-2",
                    !edge && sameDay(c.date, t) && "font-semibold text-[color:var(--accent)]",
                  )}
                >
                  {c.date.getDate()}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
