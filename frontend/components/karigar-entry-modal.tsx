"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { Icon } from "@/components/icons";

export type Direction = "in" | "out";

interface Suggestion { name: string; sizes: string[]; designs: string[] }
interface Line { key: number; name: string; size: string; design: string; qty: string }

let seq = 0;
const blank = (): Line => ({ key: ++seq, name: "", size: "", design: "", qty: "" });

/** A sheet opens with room to type into, not one row and a button. */
const BLANK_ROWS = 7;
const blankRows = () => Array.from({ length: BLANK_ROWS }, blank);

// Written out in full: Tailwind scans source text, so a class assembled from a
// template literal is never emitted and the grid collapses to one column. No gap
// — the cells butt against each other so their borders form the lattice.
const GRID = "grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_9rem_7rem_2.5rem]";

/**
 * A spreadsheet cell, not a form field. The shared Input carries its own border,
 * rounding and background, which is exactly what makes a sheet stop looking like
 * one — and `cn` is a plain join with no tailwind-merge, so those base classes
 * cannot be reliably overridden from a className. So the cell owns its input.
 */
const CELL_INPUT =
  "sheet-cell h-9 w-full min-w-0 border-0 bg-transparent px-2 text-sm text-ink outline-none";

/** Which cell is being typed into, tracked in React rather than left to CSS
 *  :focus. Excel highlights the active row as well as the cell, and a state flag
 *  can drive both — a :focus rule can only reach the input it is on. */
type Focus = { row: number; col: string } | null;

const MODES = ["Cash", "UPI", "Bank", "Cheque"];

/** Marks the active cell. The look lives in globals.css under
 *  [data-active-cell] — see the note there for why it is not a utility. */
function activeCell(focus: Focus, row: number, col: string): true | undefined {
  return focus?.row === row && focus.col === col ? true : undefined;
}

/**
 * One form for both directions of karigar movement.
 *
 * IN and OUT take the same shape because the owner thinks of them as the same
 * act recorded two ways — the direction only decides which catalogue is offered
 * and which way stock moves. Size carries the unit ("meter", "2x3"), which is how
 * the owner reads it.
 *
 * The Item box is a plain input with a datalist rather than a Combobox: a
 * Combobox can only return something already in the list, and the whole point
 * here is that typing a name the shop has never recorded creates it. The house
 * already uses this pattern for the Category field.
 */
export function KarigarEntryModal({
  karigarId,
  karigarName,
  direction,
  onClose,
  onDone,
}: {
  karigarId: number;
  karigarName: string;
  direction: Direction;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const isOut = direction === "out";

  const [date, setDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [advance, setAdvance] = useState("");
  const [mode, setMode] = useState(MODES[0]!);
  const [lines, setLines] = useState<Line[]>(blankRows);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Focus>(null);

  useEffect(() => {
    api<{ data: Suggestion[] }>(`/karigars/suggest?direction=${direction}&q=`)
      .then((d) => setSuggestions(d.data))
      .catch(() => setSuggestions([]));
  }, [direction]);

  const byName = useMemo(() => {
    const m = new Map<string, Suggestion>();
    for (const s of suggestions) m.set(s.name.toLowerCase(), s);
    return m;
  }, [suggestions]);

  function patch(key: number, p: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }

  /** Excel-like: filling the last row's name grows the sheet by one. */
  function onName(key: number, value: string, isLast: boolean) {
    patch(key, { name: value });
    if (value.trim() && isLast) setLines((ls) => [...ls, blank()]);
  }

  /** Enter in Quantity jumps to the next row's Item, as in the purchase grid. */
  const focusRow = useCallback((idx: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-name-row="${idx}"]`);
    el?.focus();
  }, []);

  function onQtyEnter(idx: number, isLast: boolean) {
    if (isLast) {
      setLines((ls) => [...ls, blank()]);
      setTimeout(() => focusRow(idx + 1), 0);
    } else {
      focusRow(idx + 1);
    }
  }

  const filled = lines.filter((l) => l.name.trim() && Number(l.qty) > 0);

  async function save() {
    if (filled.length === 0) {
      toast("Add at least one line with a name and a quantity", "error");
      return;
    }
    // A half-filled row is a typo, not an empty row — refuse rather than drop it
    // silently, which would post an entry missing something the owner typed.
    const partial = lines.find((l) => (l.name.trim() || l.qty.trim()) && !(l.name.trim() && Number(l.qty) > 0));
    if (partial) {
      toast("Every line needs both a name and a quantity", "error");
      return;
    }
    setSaving(true);
    try {
      await api(`/karigars/${karigarId}/entries`, {
        method: "POST",
        body: {
          direction,
          entry_date: date,
          remark: remark.trim() || null,
          lines: filled.map((l) => ({
            name: l.name.trim(),
            size: l.size.trim() || null,
            design: l.design.trim() || null,
            qty: Number(l.qty),
          })),
          advance: Number(advance) > 0 ? { amount: Number(advance), method: mode } : null,
        },
      });
      toast(isOut ? "Material issued" : "Goods received", "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const nameListId = `entry-names-${direction}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="page"
      title={`${isOut ? "Material out" : "Item in"} — ${karigarName}`}
      footer={(close) => (
        <>
          <span className="mr-auto text-sm text-muted">
            <span className="font-semibold text-ink tabular-nums">{filled.length}</span>{" "}
            {filled.length === 1 ? "line" : "lines"}
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : isOut ? "Save out" : "Save in"}
          </Button>
        </>
      )}
    >
      {/* Every name the shop already knows, for this direction only. Typing
          something new is allowed — that is what creates it. */}
      <datalist id={nameListId}>
        {suggestions.map((s) => <option key={s.name} value={s.name} />)}
      </datalist>

      {/* First row: when, why, and any advance handed over at the same time. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="Remark">
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What is this for…" />
        </Field>
        <Field label="Advance payment (₹)" hint="Leave blank if none">
          <Input value={advance} onChange={(e) => setAdvance(e.target.value)} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)} disabled={!(Number(advance) > 0)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
      </div>

      <div className="mt-5 overflow-hidden rounded-md border border-border-strong bg-surface">
        {/* Header reads as a sheet header: grey, tight, ruled off from the body. */}
        <div className={`${GRID} hidden border-b border-border-strong bg-surface-2 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid`}>
          <span className="border-r border-border-strong px-2 py-1.5 text-center">#</span>
          <span className="border-r border-border-strong px-2 py-1.5">Item</span>
          <span className="border-r border-border-strong px-2 py-1.5">Size</span>
          <span className="border-r border-border-strong px-2 py-1.5">Design</span>
          <span className="border-r border-border-strong px-2 py-1.5 text-right">Quantity</span>
          <span className="px-2 py-1.5" />
        </div>

        <div ref={gridRef}>
          {lines.map((l, idx) => {
            const isLast = idx === lines.length - 1;
            const known = byName.get(l.name.trim().toLowerCase());
            const sizeList = `sz-${l.key}`;
            const designList = `dg-${l.key}`;
            return (
              <div
                key={l.key}
                className={`${GRID} group border-b border-border last:border-b-0 max-sm:gap-2 max-sm:px-3 max-sm:py-3 ${
                  focus?.row === idx ? "bg-[color:var(--surface-2)]" : ""
                }`}
              >
                {/* Row-number gutter, as in a spreadsheet. */}
                <span className={`flex items-center justify-center border-r border-border text-[11px] tabular-nums max-sm:justify-start max-sm:border-0 max-sm:bg-transparent max-sm:font-semibold ${
                  focus?.row === idx ? "bg-primary-tint font-semibold text-primary" : "bg-surface-2 text-muted"
                }`}>
                  <span className="sm:hidden">Line </span>{idx + 1}
                </span>

                <div className="row-cell border-r border-border max-sm:border-0" data-active-cell={activeCell(focus, idx, "name")} data-label="Item">
                  <input
                    className={CELL_INPUT}
                    value={l.name}
                    list={nameListId}
                    data-name-row={idx}
                    onChange={(e) => onName(l.key, e.target.value, isLast)}
                    onFocus={() => setFocus({ row: idx, col: "name" })}
                    onBlur={() => setFocus((f) => (f?.row === idx && f.col === "name" ? null : f))}
                    placeholder={idx === 0 ? (isOut ? "Velvet, Board…" : "Ring Box, Tray…") : ""}
                    aria-label={`Item for line ${idx + 1}`}
                  />
                </div>

                {/* Size and design suggest what this name has been recorded with
                    before, but never restrict it — a new size is just typed. */}
                <div className="row-cell border-r border-border max-sm:border-0" data-active-cell={activeCell(focus, idx, "size")} data-label="Size">
                  <input
                    className={CELL_INPUT}
                    value={l.size}
                    list={known ? sizeList : undefined}
                    onChange={(e) => patch(l.key, { size: e.target.value })}
                    onFocus={() => setFocus({ row: idx, col: "size" })}
                    onBlur={() => setFocus((f) => (f?.row === idx && f.col === "size" ? null : f))}
                    placeholder={idx === 0 ? (isOut ? "meter" : "2x3") : ""}
                    aria-label="Size"
                  />
                  {known && (
                    <datalist id={sizeList}>
                      {known.sizes.map((v) => <option key={v} value={v} />)}
                    </datalist>
                  )}
                </div>

                <div className="row-cell border-r border-border max-sm:border-0" data-active-cell={activeCell(focus, idx, "design")} data-label="Design">
                  <input
                    className={CELL_INPUT}
                    value={l.design}
                    list={known ? designList : undefined}
                    onChange={(e) => patch(l.key, { design: e.target.value })}
                    onFocus={() => setFocus({ row: idx, col: "design" })}
                    onBlur={() => setFocus((f) => (f?.row === idx && f.col === "design" ? null : f))}
                    aria-label="Design"
                  />
                  {known && (
                    <datalist id={designList}>
                      {known.designs.map((v) => <option key={v} value={v} />)}
                    </datalist>
                  )}
                </div>

                <div className="row-cell border-r border-border max-sm:border-0" data-active-cell={activeCell(focus, idx, "qty")} data-label="Quantity">
                  <input
                    className={`${CELL_INPUT} text-right sm:text-right`}
                    value={l.qty}
                    inputMode="decimal"
                    onChange={(e) => patch(l.key, { qty: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQtyEnter(idx, isLast); } }}
                    onFocus={() => setFocus({ row: idx, col: "qty" })}
                    onBlur={() => setFocus((f) => (f?.row === idx && f.col === "qty" ? null : f))}
                    aria-label="Quantity"
                  />
                </div>

                {/* Quiet until the row has something in it — an empty sheet
                    should not show seven delete buttons. */}
                <div className="flex items-center justify-center">
                  {(l.name.trim() || l.qty.trim()) && lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
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

        <div className="flex items-center justify-between gap-3 border-t border-border-strong bg-surface-2 px-3 py-2">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, ...blankRows()])}>
            <Icon.Plus /> Add {BLANK_ROWS} more
          </Button>
          <span className="text-xs text-muted">
            Press <kbd className="rounded border border-border bg-surface px-1">Enter</kbd> in Quantity for the next line.
          </span>
        </div>
      </div>
    </Modal>
  );
}
