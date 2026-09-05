"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
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
  /** Omitted when opened from the dashboard, where no karigar is in the URL —
   *  the form asks for one itself rather than making the owner answer a separate
   *  dialog before the form they wanted appears. */
  karigarId?: number | null;
  karigarName?: string;
  direction: Direction;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const isOut = direction === "out";
  const needsKarigar = karigarId == null;

  const [pickedId, setPickedId] = useState("");
  const [pickedName, setPickedName] = useState("");
  /** Searched on the server rather than downloaded whole. The route caps what it
   *  returns, so this holds at two hundred karigars and at two thousand. */
  const searchKarigars = useCallback(async (q: string): Promise<ComboOption[]> => {
    const r = await api<{ data: { id: number; name: string; phone: string | null }[] }>(
      `/karigars/options?limit=20&q=${encodeURIComponent(q)}`,
    );
    return r.data.map((k) => ({
      value: String(k.id), label: k.name, sublabel: k.phone || undefined,
    }));
  }, []);

  const activeId = karigarId ?? (pickedId ? Number(pickedId) : null);
  const activeName = karigarName ?? pickedName;

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


  /**
   * The item column searches the server as it is typed.
   *
   * It used to ask for the whole catalogue once — `?q=` — and hold it. Each name
   * arrives with every size and colour it has been recorded in, so at four items
   * that is a small payload and at two thousand it is the entire catalogue
   * downloaded to fill a list that shows eight. The route takes a search term and
   * caps its own results; this sends what has been typed.
   */
  const [term, setTerm] = useState("");
  useEffect(() => {
    // Long enough that a word typed at speed is one request, short enough that
    // the list is there by the time the typing stops.
    const t = setTimeout(() => {
      api<{ data: Suggestion[] }>(
        `/karigars/suggest?direction=${direction}&q=${encodeURIComponent(term)}`,
      )
        .then((d) => setSuggestions(d.data))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => clearTimeout(t);
  }, [direction, term]);

  const allNames = useMemo(() => suggestions.map((x) => x.name), [suggestions]);

  /**
   * Every name looked up so far, not just the ones in the latest search.
   *
   * A row keeps its sizes and colours after the search that found it has been
   * replaced by the next row's. Without this, typing line two would empty the
   * size and design lists on line one.
   */
  const seen = useRef(new Map<string, Suggestion>());
  const [byName, setByName] = useState<Map<string, Suggestion>>(new Map());
  useEffect(() => {
    if (suggestions.length === 0) return;
    for (const s of suggestions) seen.current.set(s.name.toLowerCase(), s);
    setByName(new Map(seen.current));
  }, [suggestions]);

  const columns: SheetColumn[] = useMemo(() => [
    { field: "name", label: "Item", tint: "item", options: () => allNames, onType: setTerm,
      placeholder: isOut ? "Velvet, Board…" : "Ring Box, Tray…" },
    // Sizes and designs belong to the item on the row, so they are only offered
    // once that name is one the shop has used. Typing a new one stays valid.
    { field: "size", label: "Size", tint: "size",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.sizes ?? [],
      placeholder: isOut ? "meter" : "2x3" },
    { field: "design", label: "Design", tint: "design",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.designs ?? [] },
    { field: "qty", label: "Quantity", tint: "qty", numeric: true, align: "right" },
  ], [allNames, byName, isOut]);

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
    if (activeId == null) {
      toast("Choose a karigar first", "error");
      return;
    }
    setBadRows(new Set());
    setSaving(true);
    try {
      await api(`/karigars/${activeId}/entries`, {
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
      title={activeName ? `${isOut ? "Material out" : "Item in"} — ${activeName}` : (isOut ? "Material out" : "Item in")}
      footer={(close) => (
        <>
          <span className="mr-auto text-sm text-muted">
            <span className="font-semibold text-ink tabular-nums">{filled.length}</span>{" "}
            {filled.length === 1 ? "line" : "lines"}
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || activeId == null}>
            {saving ? <Spinner /> : isOut ? "Save out" : "Save in"}
          </Button>
        </>
      )}
    >
      {/* First row: who, when, why, and any advance handed over at the same time. */}
      <div className={`grid gap-3 sm:grid-cols-2 ${needsKarigar ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {needsKarigar && (
          <Field label="Karigar *">
            <Combobox
              options={[]}
              search={searchKarigars}
              value={pickedId}
              onChange={setPickedId}
              onPick={(o) => setPickedName(o.label)}
              placeholder="Search karigar…"
              emptyText="No karigar matches"
              ariaLabel="Karigar"
              autoFocus
            />
          </Field>
        )}
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
