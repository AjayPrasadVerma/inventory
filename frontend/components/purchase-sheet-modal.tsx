"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { rupees, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import {
  BLANK_ROWS, EntrySheet, numeric, type SheetColumn, type SheetRow,
} from "@/components/ui/entry-sheet";

interface Suggestion {
  name: string;
  kind: "item" | "product";
  sizes: string[];
  designs: string[];
}

let seq = 0;
const blank = (): SheetRow => ({ key: ++seq, name: "", size: "", design: "", qty: "", rate: "" });

// Written out in full: Tailwind scans source text, so a template assembled from
// data is never emitted and the grid collapses to one column.
const GRID =
  "grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_6.5rem_9rem_5rem_6rem_7rem_2.5rem] xl:grid-cols-[2.5rem_minmax(0,1fr)_7.5rem_14rem_5.5rem_7rem_8rem_2.5rem]";

const lineAmount = (r: SheetRow) => (Number(r.qty) || 0) * (Number(r.rate) || 0);

/**
 * A vendor bill, typed as a sheet.
 *
 * Same sheet as the karigar side, two columns wider: a purchase has a rate, and
 * the amount follows from it rather than being typed — a total that can disagree
 * with its own quantity and rate is a bug waiting to be found in a ledger.
 *
 * Creating only. Editing an existing bill still goes through PurchaseModal, which
 * works on ids: a finished line's size and design cannot be recovered from what
 * that screen loads today, and quietly guessing them would rewrite a bill.
 */
export function PurchaseSheetModal({
  vendorId,
  vendorName,
  onClose,
  onDone,
}: {
  vendorId: number;
  vendorName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();

  const [date, setDate] = useState(todayISO());
  const [billNo, setBillNo] = useState("");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SheetRow[]>(() => Array.from({ length: BLANK_ROWS }, blank));
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

  const allNames = useMemo(() => suggestions.map((s) => s.name), [suggestions]);
  const allSizes = useMemo(
    () => [...new Set(suggestions.flatMap((s) => s.sizes))].sort(), [suggestions]);
  const allDesigns = useMemo(
    () => [...new Set(suggestions.flatMap((s) => s.designs))].sort(), [suggestions]);
  const byName = useMemo(() => {
    const m = new Map<string, Suggestion>();
    for (const s of suggestions) m.set(s.name.toLowerCase(), s);
    return m;
  }, [suggestions]);

  const columns: SheetColumn[] = useMemo(() => [
    { field: "name", label: "Item", tint: "item", options: () => allNames,
      placeholder: "Velvet, Ring Box…" },
    { field: "size", label: "Size", tint: "size",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.sizes ?? allSizes,
      placeholder: "meter" },
    { field: "design", label: "Design", tint: "design",
      options: (r) => byName.get(String(r.name).trim().toLowerCase())?.designs ?? allDesigns },
    { field: "qty", label: "Quantity", tint: "qty", numeric: true, align: "right" },
    { field: "rate", label: "Rate", tint: "qty", numeric: true, align: "right" },
    // Derived, never typed, so a line's total cannot disagree with itself.
    { field: "amount", label: "Amount", tint: "qty", align: "right",
      compute: (r) => (lineAmount(r) > 0 ? rupees(lineAmount(r)) : "") },
  ], [allNames, allSizes, allDesigns, byName]);

  const filled = lines.filter((l) => String(l.name).trim() && Number(l.qty) > 0);
  const total = filled.reduce((s, l) => s + lineAmount(l), 0);

  async function save() {
    // A row with something in it but not everything is a typo, not an empty row.
    // Every offending row is marked, not just the first.
    const bad = new Set<number>();
    lines.forEach((l) => {
      const touched = ["name", "size", "design", "qty", "rate"].some((f) => String(l[f] ?? "").trim());
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
    if (Number(paid) > total) {
      toast("Paid now is more than the bill total", "error");
      return;
    }
    setBadRows(new Set());
    setSaving(true);
    try {
      await api("/purchases", {
        method: "POST",
        body: {
          vendor_id: vendorId,
          purchase_date: date,
          bill_no: billNo.trim() || null,
          notes: notes.trim() || null,
          amount_paid: Number(paid) || 0,
          items: filled.map((l) => ({
            name: String(l.name).trim(),
            size: String(l.size).trim() || null,
            design: String(l.design).trim() || null,
            qty: Number(l.qty),
            rate: Number(l.rate) || 0,
          })),
        },
      });
      toast("Purchase saved", "success");
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
      title={`New purchase — ${vendorName}`}
      footer={(close) => (
        <>
          <span className="mr-auto flex items-baseline gap-4 text-sm text-muted">
            <span>
              <span className="font-semibold text-ink tabular-nums">{filled.length}</span>{" "}
              {filled.length === 1 ? "line" : "lines"}
            </span>
            <span>
              Total{" "}
              <span className="font-mono text-base font-bold tabular-nums text-ink">{rupees(total)}</span>
            </span>
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : "Save purchase"}
          </Button>
        </>
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="Bill No. (optional)">
          <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. INV-1042" />
        </Field>
        <Field label="Paid now (₹)" hint="Leave blank if nothing paid yet">
          <Input value={paid} onChange={(e) => setPaid(numeric(e.target.value))} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to note…" />
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
