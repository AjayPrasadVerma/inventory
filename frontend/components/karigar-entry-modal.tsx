"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import {
  BLANK_ROWS, EntrySheet, numeric, type SheetColumn, type SheetRow,
} from "@/components/ui/entry-sheet";

export type Direction = "in" | "out";

interface Suggestion { name: string; sizes: string[]; designs: string[] }

let seq = 0;
const blank = (): SheetRow => ({ key: ++seq, name: "", size: "", design: "", qty: "" });

// Written out in full: Tailwind scans source text, so a template assembled from
// data is never emitted and the grid collapses to one column.
const GRID =
  "grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_11rem_5rem_2.5rem] xl:grid-cols-[2.5rem_minmax(0,1fr)_8rem_18rem_5.5rem_2.5rem]";

const MODES = ["Cash", "UPI", "Bank", "Cheque"];

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
  const [lines, setLines] = useState<SheetRow[]>(() => Array.from({ length: BLANK_ROWS }, blank));
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);
  /** Rows a save attempt rejected. A toast alone leaves the owner hunting for
   *  which of fourteen rows it meant. */
  const [badRows, setBadRows] = useState<Set<number>>(() => new Set());


  useEffect(() => {
    api<{ data: Suggestion[] }>(`/karigars/suggest?direction=${direction}&q=`)
      .then((d) => setSuggestions(d.data))
      .catch(() => setSuggestions([]));
  }, [direction]);

  /** Every name for this direction, plus every size and design the shop has used —
   *  the latter as a fallback until a row's name is recognised. */
  const allNames = useMemo(() => suggestions.map((x) => x.name), [suggestions]);
  const allSizes = useMemo(
    () => [...new Set(suggestions.flatMap((x) => x.sizes))].sort(),
    [suggestions],
  );
  const allDesigns = useMemo(
    () => [...new Set(suggestions.flatMap((x) => x.designs))].sort(),
    [suggestions],
  );

  const byName = useMemo(() => {
    const m = new Map<string, Suggestion>();
    for (const s of suggestions) m.set(s.name.toLowerCase(), s);
    return m;
  }, [suggestions]);




  const columns: SheetColumn[] = useMemo(() => [
    { field: "name", label: "Item", tint: "item", options: () => allNames,
      placeholder: isOut ? "Velvet, Board…" : "Ring Box, Tray…" },
    { field: "size", label: "Size", tint: "size",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.sizes ?? allSizes,
      placeholder: isOut ? "meter" : "2x3" },
    { field: "design", label: "Design", tint: "design",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.designs ?? allDesigns },
    { field: "qty", label: "Quantity", tint: "qty", numeric: true, align: "right" },
  ], [allNames, allSizes, allDesigns, byName, isOut]);

  const filled = lines.filter((l) => String(l.name).trim() && Number(l.qty) > 0);

  async function save() {
    // A row with something in it but not everything is a typo, not an empty row —
    // refuse rather than drop it silently, which would post an entry missing what
    // the owner had typed. Every offending row is marked, not just the first.
    const bad = new Set<number>();
    lines.forEach((l) => {
      const touched = ["name", "size", "design", "qty"].some((f) => String(l[f] ?? "").trim());
      if (touched && !(String(l.name).trim() && Number(l.qty) > 0)) bad.add(l.key);
    });
    if (bad.size > 0) {
      setBadRows(bad);
      toast("Every line that has anything in it needs a name and a quantity above 0", "error");
      return;
    }
    if (filled.length === 0) {
      toast("Add at least one line with a name and a quantity", "error");
      return;
    }
    setBadRows(new Set());
    setSaving(true);
    try {
      await api(`/karigars/${karigarId}/entries`, {
        method: "POST",
        body: {
          direction,
          entry_date: date,
          remark: remark.trim() || null,
          lines: filled.map((l) => ({
            name: String(l.name).trim(),
            size: String(l.size).trim() || null,
            design: String(l.design).trim() || null,
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

  return (
    <Modal
      open
      onClose={onClose}
      size="sheet"
      fill
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
      {/* First row: when, why, and any advance handed over at the same time. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="Remark">
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What is this for…" />
        </Field>
        <Field label="Advance payment (₹)" hint="Leave blank if none">
          <Input value={advance} onChange={(e) => setAdvance(numeric(e.target.value))} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)} disabled={!(Number(advance) > 0)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
      </div>

      <EntrySheet
        gridClass={GRID}
        columns={columns}
        rows={lines}
        setRows={setLines}
        makeBlank={blank}
        badKeys={badRows}
        onEdit={(key) => setBadRows((b) => {
          if (!b.has(key)) return b;
          const next = new Set(b);
          next.delete(key);
          return next;
        })}
      />
    </Modal>
  );
}
