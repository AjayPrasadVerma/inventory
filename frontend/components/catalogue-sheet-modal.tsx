"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { bustCache } from "@/lib/cache";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import {
  BLANK_ROWS, EntrySheet, type SheetColumn, type SheetRow,
} from "@/components/ui/entry-sheet";

/** Raw material or finished goods. The list shows both; the sheet adds and edits
 *  either, and which one decides where stock lands. */
export type CatalogueKind = "item" | "product";
type Kind = CatalogueKind;

/** One stock bucket of a record, with what is in it. */
export interface VariantRow { size: string | null; design: string | null; qty: number }

/** A catalogue row as the list holds it. */
export interface CatalogueRecord {
  kind: CatalogueKind;
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  units: string[];
  variants: string[];
  variant_rows?: VariantRow[];
}

interface Suggestion { name: string; kind: Kind; sizes: string[]; designs: string[] }

/** The record being edited, as the list already holds it. */
export interface SheetRecord {
  id: number;
  kind: Kind;
  name: string;
  /** One row per size-and-design the record is stocked in, with what is on hand. */
  rows: { size: string | null; design: string | null; qty: number }[];
}

let seq = 0;
const blank = (): SheetRow => ({ key: ++seq, name: "", size: "", design: "", qty: "" });

// Written out in full: Tailwind scans source text, so a template assembled from
// data is never emitted and the grid collapses to one column.
const GRID =
  "grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_11rem_5rem_2.5rem] xl:grid-cols-[2.5rem_minmax(0,1fr)_8rem_18rem_5.5rem_2.5rem]";

/**
 * Add things to the catalogue the same way movement is recorded — as a sheet.
 *
 * The owner does not think of "create the product, then set its opening stock" as
 * two acts: a thing exists because there is some of it on the shelf. So one line
 * does both, and it reads exactly like the In sheet, because it is the same
 * gesture.
 *
 * Type sits in the first row rather than on each line. A sheet is filled in one
 * sitting and the shop is either stocking raw material or finished goods at that
 * moment; asking per row would be a column of identical answers.
 */
export function CatalogueSheetModal({
  record,
  onClose,
  onDone,
}: {
  /** Omitted when adding. Present when editing, and then the sheet opens on that
   *  record's rows — same gesture either way, which is what was asked for. */
  record?: SheetRecord | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const editing = record != null;

  const [kind, setKind] = useState<Kind>(record?.kind ?? "item");
  const [date, setDate] = useState(todayISO());
  const [lines, setLines] = useState<SheetRow[]>(() => {
    if (!record) return Array.from({ length: BLANK_ROWS }, blank);
    // Quantity arrives showing what is on hand, so changing it reads as "make the
    // stock this" — the server books only the difference.
    const rows = record.rows.map((r) => ({
      key: ++seq, name: record.name, size: r.size ?? "", design: r.design ?? "", qty: String(r.qty),
    }));
    return rows.length > 0 ? rows : [{ ...blank(), name: record.name }];
  });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);
  /** Rows a save attempt rejected. A toast alone leaves the owner hunting for
   *  which of fourteen rows it meant. */
  const [badRows, setBadRows] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    api<{ data: Suggestion[] }>("/purchases/suggest")
      .then((d) => setSuggestions(d.data))
      .catch(() => setSuggestions([]));
  }, []);

  // Only names of the kind being added — offering a finished box while stocking
  // raw material would invite creating it in the wrong catalogue.
  const mine = useMemo(() => suggestions.filter((s) => s.kind === kind), [suggestions, kind]);
  const allNames = useMemo(() => mine.map((s) => s.name), [mine]);
  const allSizes = useMemo(() => [...new Set(mine.flatMap((s) => s.sizes))].sort(), [mine]);
  const allDesigns = useMemo(() => [...new Set(mine.flatMap((s) => s.designs))].sort(), [mine]);
  const byName = useMemo(() => {
    const m = new Map<string, Suggestion>();
    for (const s of mine) m.set(s.name.toLowerCase(), s);
    return m;
  }, [mine]);

  const isRaw = kind === "item";

  const columns: SheetColumn[] = useMemo(() => [
    { field: "name", label: "Item", tint: "item", options: () => allNames,
      placeholder: isRaw ? "Velvet, Board…" : "Ring Box, Tray…" },
    { field: "size", label: "Size", tint: "size",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.sizes ?? allSizes,
      placeholder: isRaw ? "meter" : "2x3" },
    { field: "design", label: "Design", tint: "design",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.designs ?? allDesigns },
    { field: "qty", label: "Quantity", tint: "qty", numeric: true, align: "right" },
  ], [allNames, allSizes, allDesigns, byName, isRaw]);

  const named = lines.filter((l) => String(l.name).trim());

  async function save() {
    // A row with a size or a quantity but no name is a typo, not an empty row.
    // Quantity itself is optional here — a thing can be stocked before any of it
    // is in hand — so only the name is required.
    const bad = new Set<number>();
    lines.forEach((l) => {
      const touched = ["name", "size", "design", "qty"].some((f) => String(l[f] ?? "").trim());
      if (touched && !String(l.name).trim()) bad.add(l.key);
    });
    if (bad.size > 0) {
      setBadRows(bad);
      toast("Every line that has anything in it needs a name", "error");
      return;
    }
    if (named.length === 0) {
      toast("Add at least one line with a name", "error");
      return;
    }
    setBadRows(new Set());
    setSaving(true);
    try {
      // Changing the type moves the record — and its stock — to the other
      // catalogue, so it happens first and everything after it applies to the
      // record in its new home.
      let targetId = record?.id ?? 0;
      if (editing && kind !== record.kind) {
        const moved = await api<{ data: { id: number } }>(`/catalogue/${record.id}/kind`, {
          method: "PUT",
          body: { from: record.kind, on_date: date },
        });
        targetId = moved.data.id;
      }

      if (editing) {
        await api(`/catalogue/${targetId}/sheet`, {
          method: "PUT",
          body: {
            kind,
            name: String(named[0]!.name).trim(),
            on_date: date,
            lines: named.map((l) => ({
              size: String(l.size).trim() || null,
              design: String(l.design).trim() || null,
              qty: String(l.qty).trim() === "" ? null : Number(l.qty),
            })),
          },
        });
      } else {
        await api("/catalogue/bulk", {
          method: "POST",
          body: {
            kind,
            on_date: date,
            lines: named.map((l) => ({
              name: String(l.name).trim(),
              size: String(l.size).trim() || null,
              design: String(l.design).trim() || null,
              qty: Number(l.qty) || 0,
            })),
          },
        });
      }
      // The catalogue changed, so anything holding a cached copy has to let go.
      bustCache("/catalogue");
      toast(editing ? "Saved" : `${named.length} ${named.length === 1 ? "line" : "lines"} added`, "success");
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
      title={editing
        ? `Edit ${record.name}`
        : isRaw ? "Add raw material" : "Add finished products"}
      footer={(close) => (
        <>
          <span className="mr-auto text-sm text-muted">
            <span className="font-semibold text-ink tabular-nums">{named.length}</span>{" "}
            {named.length === 1 ? "line" : "lines"}
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save"}</Button>
        </>
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Type *"
          hint={editing
            ? (kind !== record.kind
                ? "Saving will move this and its stock to the other catalogue"
                : "Changing this moves the record and its stock — only possible while nothing has used it")
            : "Raw material is issued to karigars; finished goods come back or are bought in"}
        >
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="item">Raw material</option>
            <option value="product">Finished product</option>
          </Select>
        </Field>
        <Field label={editing ? "Correction date" : "Opening stock date"} hint="When this stock was counted">
          <DateField value={date} onChange={setDate} max={todayISO()} />
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
        note={editing
          ? <>Quantity is what is on hand — change it to correct the stock, or leave it to keep it.</>
          : <>Quantity is optional — leave it blank to add the name without stock.</>}
      />
    </Modal>
  );
}
