"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const inputBase =
  "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-primary";
const invalidRing =
  "border-[color:var(--danger)] focus:border-[color:var(--danger)]";

export interface DateFieldProps {
  value: string; // ISO "yyyy-mm-dd"; may be "" for empty
  onChange: (iso: string) => void; // fires with ISO "yyyy-mm-dd"
  max?: string; // ISO; dates after this are disabled/unselectable
  min?: string; // ISO; dates before this are disabled
  invalid?: boolean; // red border when true
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Parse "yyyy-mm-dd" into a local Date at midnight (no UTC/timezone shift). */
function parseISO(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Build an ISO "yyyy-mm-dd" string from explicit local year/month/day. */
function toISO(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isSameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDDMMYYYY(iso: string): string {
  const d = parseISO(iso);
  if (!d) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface DayCell {
  date: Date;
  inCurrentMonth: boolean;
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startWeekday);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({ date: d, inCurrentMonth: d.getMonth() === month });
  }
  return cells;
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-muted"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function DateField({
  value,
  onChange,
  max,
  min,
  invalid,
  disabled,
  ariaLabel,
  className,
}: DateFieldProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const selectedDate = parseISO(value);
  const today = todayLocal();
  const maxDate = parseISO(max);
  const minDate = parseISO(min);

  const initialView = selectedDate ?? today;
  const [viewYear, setViewYear] = React.useState(initialView.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(initialView.getMonth());

  // Keep the visible month in sync if the value changes externally while closed.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync the visible month to `value` only while the popover is closed
  React.useEffect(() => {
    if (!open) {
      const base = parseISO(value) ?? todayLocal();
      setViewYear(base.getFullYear());
      setViewMonth(base.getMonth());
    }
  }, [value, open]);

  React.useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function isDisabled(d: Date): boolean {
    if (maxDate && d.getTime() > maxDate.getTime()) return true;
    if (minDate && d.getTime() < minDate.getTime()) return true;
    return false;
  }

  function goToPrevMonth() {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }

  function goToNextMonth() {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }

  function selectDate(d: Date) {
    if (isDisabled(d)) return;
    onChange(toISO(d.getFullYear(), d.getMonth(), d.getDate()));
    setOpen(false);
  }

  function selectToday() {
    const t = todayLocal();
    if (isDisabled(t)) return;
    onChange(toISO(t.getFullYear(), t.getMonth(), t.getDate()));
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setOpen(false);
  }

  const cells = buildMonthGrid(viewYear, viewMonth);
  const display = formatDDMMYYYY(value);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={cn(
          inputBase,
          "flex items-center justify-between text-left",
          disabled && "opacity-50 pointer-events-none",
          invalid && invalidRing,
          className
        )}
      >
        <span className={display ? "text-ink" : "text-muted"}>{display || "DD/MM/YYYY"}</span>
        <CalendarIcon />
      </button>

      {open && !disabled ? (
        <div
          role="dialog"
          className="absolute z-30 mt-1 rounded-lg border border-border bg-surface shadow-[var(--shadow-md)] p-3 w-[17rem]"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="h-8 w-8 rounded-md hover:bg-surface-2 text-muted"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-ink">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="h-8 w-8 rounded-md hover:bg-surface-2 text-muted"
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-xs text-muted">
            {WEEKDAYS.map((w) => (
              <div key={w} className="h-6 flex items-center justify-center">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((cell, idx) => {
              const disabledCell = isDisabled(cell.date);
              const selected = isSameDay(cell.date, selectedDate);
              const isToday = isSameDay(cell.date, today);
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={disabledCell}
                  onClick={() => selectDate(cell.date)}
                  className={cn(
                    "h-9 w-9 rounded-md text-sm flex items-center justify-center hover:bg-surface-2",
                    !cell.inCurrentMonth && "text-muted",
                    disabledCell && "opacity-40 pointer-events-none",
                    selected && "bg-primary text-primary-fg hover:bg-primary",
                    isToday && !selected && "border border-[color:var(--accent)] text-[color:var(--accent)]"
                  )}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-end border-t border-border pt-2">
            <button type="button" onClick={selectToday} className="text-sm text-primary font-medium">
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
