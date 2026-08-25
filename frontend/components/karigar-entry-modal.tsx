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

// Written out in full: Tailwind scans source text, so a class assembled from a
// template literal is never emitted and the grid collapses to one column.
const GRID = "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_9rem_9rem_7rem_2.25rem] sm:items-center";

const MODES = ["Cash", "UPI", "Bank", "Cheque"];

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
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

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

      <div className="mt-5 overflow-hidden rounded-[14px] border border-border bg-surface">
        <div className={`${GRID} hidden border-b border-border bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted sm:grid`}>
          <span>#</span>
          <span>Item</span>
          <span>Size</span>
          <span>Design</span>
          <span className="text-right">Quantity</span>
          <span />
        </div>

        <div ref={gridRef}>
          {lines.map((l, idx) => {
            const isLast = idx === lines.length - 1;
            const known = byName.get(l.name.trim().toLowerCase());
            const sizeList = `sz-${l.key}`;
            const designList = `dg-${l.key}`;
            return (
              <div key={l.key} className={`${GRID} border-b border-border px-3 py-3 last:border-b-0 sm:py-1.5`}>
                <span className="text-xs font-semibold tabular-nums text-muted sm:font-normal">
                  <span className="sm:hidden">Line </span>{idx + 1}
                </span>

                <div className="row-cell" data-label="Item">
                  <Input
                    dense
                    value={l.name}
                    list={nameListId}
                    data-name-row={idx}
                    onChange={(e) => onName(l.key, e.target.value, isLast)}
                    placeholder={isOut ? "Velvet, Board…" : "Ring Box, Tray…"}
                    aria-label={`Item for line ${idx + 1}`}
                  />
                </div>

                {/* Size and design suggest what this name has been recorded with
                    before, but never restrict it — a new size is just typed. */}
                <div className="row-cell" data-label="Size">
                  <Input
                    dense
                    value={l.size}
                    list={known ? sizeList : undefined}
                    onChange={(e) => patch(l.key, { size: e.target.value })}
                    placeholder={isOut ? "meter" : "2x3"}
                    aria-label="Size"
                  />
                  {known && (
                    <datalist id={sizeList}>
                      {known.sizes.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  )}
                </div>

                <div className="row-cell" data-label="Design">
                  <Input
                    dense
                    value={l.design}
                    list={known ? designList : undefined}
                    onChange={(e) => patch(l.key, { design: e.target.value })}
                    placeholder="—"
                    aria-label="Design"
                  />
                  {known && (
                    <datalist id={designList}>
                      {known.designs.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  )}
                </div>

                <div className="row-cell" data-label="Quantity">
                  <Input
                    dense
                    className="text-right"
                    value={l.qty}
                    inputMode="decimal"
                    placeholder="0"
                    onChange={(e) => patch(l.key, { qty: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQtyEnter(idx, isLast); } }}
                    aria-label="Quantity"
                  />
                </div>

                <div className="flex justify-end">
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <Icon.Trash />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-3 py-2">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Icon.Plus /> Add line
          </Button>
          <span className="text-xs text-muted">
            Press <kbd className="rounded border border-border bg-surface px-1">Enter</kbd> in Quantity for the next line.
          </span>
        </div>
      </div>
    </Modal>
  );
}
