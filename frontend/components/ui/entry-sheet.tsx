"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icons";
import { SheetSuggest } from "@/components/ui/sheet-suggest";

/**
 * The spreadsheet the owner types entries into.
 *
 * Karigar movement and vendor purchases are the same act of typing lines, so this
 * is one component driven by a column spec rather than two sheets that have to be
 * fixed twice every time the layout is tweaked — which it has been, repeatedly.
 *
 * The grid template comes in as a literal class from the caller, not built from
 * the spec. Tailwind scans source text: a template assembled from data is never
 * emitted, and the grid silently collapses to a single column. That failure has
 * already shipped here once.
 */

export interface SheetRow {
  key: number;
  [field: string]: string | number;
}

export interface SheetColumn {
  field: string;
  label: string;
  /** Which column tint to paint. See --sheet-* in globals.css. */
  tint: "item" | "size" | "design" | "qty";
  align?: "right";
  placeholder?: string;
  /** Offer these, but never restrict to them — a new value is just typed. */
  options?: (row: SheetRow) => string[];
  /** Digits and a single decimal point only. */
  numeric?: boolean;
  /** Derived and read-only, e.g. an amount from qty × rate. */
  compute?: (row: SheetRow) => string;
}

const CELL_INPUT =
  "sheet-cell h-9 w-full min-w-0 border-0 bg-transparent px-2 text-sm text-ink outline-none";

const TINT: Record<SheetColumn["tint"], string> = {
  item: "sheet-col-item",
  size: "sheet-col-size",
  design: "sheet-col-design",
  qty: "sheet-col-qty",
};

/** Keep only digits and a single decimal point. */export function numeric(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const i = cleaned.indexOf(".");
  if (i === -1) return cleaned;
  return cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, "");
}

/** A sheet opens with room to type into, not one row and a button. */
export const BLANK_ROWS = 7;

type Focus = { row: number; field: string } | null;

export function EntrySheet({
  gridClass,
  columns,
  rows,
  setRows,
  makeBlank,
  badKeys,
  onEdit,
  note,
}: {
  /** Literal Tailwind grid template, including the gutter and the remove column. */
  gridClass: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  setRows: React.Dispatch<React.SetStateAction<SheetRow[]>>;
  makeBlank: () => SheetRow;
  /** Rows a save attempt rejected, painted so the owner is not left hunting. */
  badKeys?: Set<number>;
  /** Called with a row's key whenever it is edited, so a rejection mark clears. */
  onEdit?: (key: number) => void;
  note?: React.ReactNode;
}) {
  const [focus, setFocus] = useState<Focus>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Fill the sheet's height with real rows rather than leaving ruled paper
   * stopping halfway down a tall panel. Rows are only added, never removed, so
   * shrinking the window cannot eat something half-typed.
   */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const row = box.firstElementChild as HTMLElement | null;
      const rowH = row?.offsetHeight ?? 0;
      if (rowH <= 0) return;
      const want = Math.floor(box.clientHeight / rowH);
      setRows((ls) => {
        if (ls.length >= want) return ls;
        const add = Array.from({ length: want - ls.length }, makeBlank);
        return [...ls, ...add];
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
    // makeBlank is a stable factory from the caller; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRows]);

  function patch(key: number, field: string, value: string) {
    setRows((ls) => ls.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    onEdit?.(key);
  }

  /**
   * Enter moves to the next box, left to right and then down onto the following
   * row. Resolved from the inputs' DOM order rather than from a row-and-column
   * map, so it cannot drift out of step with the markup.
   */
  function onCellEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const box = boxRef.current;
    if (!box) return;
    const inputs = [...box.querySelectorAll<HTMLInputElement>("input:not([readonly])")];
    const i = inputs.indexOf(e.currentTarget);
    if (i < 0) return;
    const next = inputs[i + 1];
    if (next) {
      next.focus();
      next.select();
      return;
    }
    setRows((ls) => [...ls, makeBlank()]);
    setTimeout(() => {
      const grown = [...(boxRef.current?.querySelectorAll<HTMLInputElement>("input:not([readonly])") ?? [])];
      grown[i + 1]?.focus();
    }, 0);
  }

  const firstField = columns[0]?.field;

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-strong bg-surface">
      <div className={`${gridClass} hidden shrink-0 border-b border-border-strong bg-surface-2 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid`}>
        <span className="sheet-col-num border-r border-border-strong px-2 py-1.5 text-center">#</span>
        {columns.map((c) => (
          <span
            key={c.field}
            className={`${TINT[c.tint]} border-r border-border-strong px-2 py-1.5 ${c.align === "right" ? "text-right" : ""}`}
          >
            {c.label}
          </span>
        ))}
        <span className="px-2 py-1.5" />
      </div>

      <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row, idx) => {
          const isLast = idx === rows.length - 1;
          const touched = columns.some((c) => String(row[c.field] ?? "").trim());
          return (
            <div
              key={row.key}
              data-bad-row={badKeys?.has(row.key) ? true : undefined}
              className={`${gridClass} border-b border-border last:border-b-0 max-sm:gap-2 max-sm:px-3 max-sm:py-3 ${
                focus?.row === idx ? "bg-[color:var(--surface-2)]" : ""
              }`}
            >
              <span
                className={`flex items-center justify-center border-r border-border text-[11px] tabular-nums max-sm:justify-start max-sm:border-0 max-sm:bg-transparent max-sm:font-semibold ${
                  focus?.row === idx ? "bg-primary-tint font-semibold text-primary" : "sheet-col-num text-muted"
                }`}
              >
                <span className="sm:hidden">Line </span>{idx + 1}
              </span>

              {columns.map((c) => {
                const value = String(row[c.field] ?? "");
                const opts = c.options?.(row);
                const active = focus?.row === idx && focus.field === c.field;
                return (
                  <div
                    key={c.field}
                    className={`sheet-cell-wrap ${TINT[c.tint]} border-r border-border max-sm:border-0`}
                    data-active-cell={active ? true : undefined}
                    data-label={c.label}
                  >
                    {c.compute ? (
                      // Derived, so it is shown rather than typed — and skipped by
                      // Enter, which only walks the boxes you can fill.
                      <span className={`block px-2 py-2 text-sm font-semibold tabular-nums text-ink ${c.align === "right" ? "sm:text-right" : ""}`}>
                        {c.compute(row) || "—"}
                      </span>
                    ) : opts ? (
                      <SheetSuggest
                        className={CELL_INPUT}
                        value={value}
                        options={opts}
                        data-sheet-first={c.field === firstField ? idx : undefined}
                        onChange={(v) => {
                          patch(row.key, c.field, v);
                          if (v.trim() && isLast && c.field === firstField) {
                            setRows((ls) => [...ls, makeBlank()]);
                          }
                        }}
                        onEnter={onCellEnter}
                        onFocus={() => setFocus({ row: idx, field: c.field })}
                        onBlur={() => setFocus((f) => (f?.row === idx && f.field === c.field ? null : f))}
                        placeholder={idx === 0 ? c.placeholder : ""}
                        ariaLabel={`${c.label} for line ${idx + 1}`}
                      />
                    ) : (
                      <input
                        className={`${CELL_INPUT} ${c.align === "right" ? "text-right" : ""}`}
                        value={value}
                        inputMode={c.numeric ? "decimal" : undefined}
                        onChange={(e) => patch(row.key, c.field, c.numeric ? numeric(e.target.value) : e.target.value)}
                        onKeyDown={onCellEnter}
                        onFocus={() => setFocus({ row: idx, field: c.field })}
                        onBlur={() => setFocus((f) => (f?.row === idx && f.field === c.field ? null : f))}
                        placeholder={idx === 0 ? c.placeholder : ""}
                        aria-label={`${c.label} for line ${idx + 1}`}
                      />
                    )}
                  </div>
                );
              })}

              {/* Quiet until the row has something in it — an empty sheet should
                  not show fourteen delete buttons. */}
              <div className="flex items-center justify-center">
                {touched && rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((ls) => ls.filter((x) => x.key !== row.key))}
                    aria-label={`Clear line ${idx + 1}`}
                    className="cursor-pointer px-2 text-muted transition-colors hover:text-[color:var(--danger)]"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-strong bg-surface-2 px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows((ls) => [...ls, ...Array.from({ length: BLANK_ROWS }, makeBlank)])}
        >
          <Icon.Plus /> Add {BLANK_ROWS} more
        </Button>
        <span className="text-xs text-muted">
          {note ?? (
            <>Press <kbd className="rounded border border-border bg-surface px-1">Enter</kbd> to move to the next box.</>
          )}
        </span>
      </div>
    </div>
  );
}
