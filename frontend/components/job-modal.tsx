"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { qty as fmtQty, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { PAY_METHODS } from "@/components/pay-vendor-modal";
import { MaterialRows, blankMaterial, materialPayload, type ItemOpt, type MaterialLine } from "@/components/material-rows";

interface StockRow { item_id: number; variant_id: number | null; unit: string; on_hand: string }

const stockKey = (itemId: number, variantId: number | null, unit: string) => `${itemId}:${variantId ?? 0}:${unit}`;

/**
 * Issue material to ONE karigar as a new job, opened right on the karigar's
 * account page — so the karigar is already known and never asked for again.
 */
export function JobModal({
  karigarId,
  karigarName,
  onClose,
  onDone,
}: {
  karigarId: number;
  karigarName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<MaterialLine[]>([blankMaterial()]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, st] = await Promise.all([
        cachedGet<{ data: ItemOpt[] }>("/items/options"),
        cachedGet<{ data: StockRow[] }>("/reports/raw-stock"),
      ]);
      const map: Record<string, number> = {};
      for (const r of st.data) map[stockKey(r.item_id, r.variant_id, r.unit)] = Number(r.on_hand) || 0;
      setItems(i.data);
      setStock(map);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Could not load materials.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state is set only after await
  useEffect(() => { load(); }, [load]);

  const lineStatus = useCallback((l: MaterialLine): "empty" | "complete" | "invalid" => {
    const hasItem = !!l.itemId;
    const q = l.qty.trim();
    if (!hasItem && q === "") return "empty";
    if (hasItem && q !== "" && Number(q) > 0 && !!l.unit) return "complete";
    return "invalid";
  }, []);

  const errors = useMemo(() => {
    const invalidKeys = new Set<number>();
    let complete = 0;
    for (const l of lines) {
      const st = lineStatus(l);
      if (st === "invalid") invalidKeys.add(l.key);
      if (st === "complete") complete++;
    }
    const itemErr = invalidKeys.size > 0
      ? "Some rows are incomplete — each needs a material, a unit, and a quantity greater than 0."
      : complete === 0
        ? "Add at least one material to issue."
        : undefined;
    return { invalidKeys, itemErr, hasError: !!itemErr };
  }, [lines, lineStatus]);

  /** Live oversell notice — issuing more than is on hand is allowed, just flagged. */
  const oversold = useMemo(() => {
    const need = new Map<string, number>();
    for (const it of materialPayload(lines)) {
      const k = stockKey(it.item_id, it.variant_id, it.unit);
      need.set(k, (need.get(k) ?? 0) + it.qty);
    }
    return [...need.entries()]
      .map(([k, want]) => {
        const have = stock[k] ?? 0;
        const [itemId, variantId] = k.split(":").map(Number);
        const item = items.find((x) => x.id === itemId);
        const colour = variantId ? item?.variant_options.find((v) => v.id === variantId)?.color : "";
        const unit = k.split(":")[2] ?? "";
        return { label: `${item?.name ?? "Material"}${colour ? ` (${colour})` : ""} · ${unit}`, want, have };
      })
      .filter((o) => o.want > o.have);
  }, [lines, stock, items]);

  async function save() {
    setSubmitted(true);
    if (errors.hasError) { toast("Please fix the highlighted rows.", "error"); return; }
    setSaving(true);
    try {
      await api("/jobs", {
        method: "POST",
        body: {
          karigar_id: karigarId,
          job_date: date,
          expected_note: expected.trim() || null,
          notes: notes.trim() || null,
          issues: materialPayload(lines),
          payment: Number(amount) > 0 ? { amount: Number(amount), method } : undefined,
        },
      });
      toast("Job created — material issued.", "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const show = submitted;

  return (
    <Modal
      open
      onClose={onClose}
      size="page"
      title={`Issue material to ${karigarName}`}
      footer={(close) => (
        <>
          <span className="mr-auto text-sm text-muted">
            {materialPayload(lines).length} material{materialPayload(lines).length === 1 ? "" : "s"} to issue
            {Number(amount) > 0 ? ` · advance ₹${Number(amount).toLocaleString("en-IN")}` : ""}
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || !!loadError}>
            {saving ? <Spinner /> : "Issue material"}
          </Button>
        </>
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted"><Spinner /> Loading materials…</div>
      ) : loadError ? (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-ink">Could not load the form.</p>
          <p className="mt-1 text-sm text-muted">{loadError}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Date">
              <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Job date" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="What to make (optional)">
                <Input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="e.g. 50 ring boxes, small" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Advance (₹)">
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="Mode">
                <Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={!(Number(amount) > 0)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Material issued</h3>
            <MaterialRows
              items={items}
              lines={lines}
              setLines={setLines}
              invalidKeys={show ? errors.invalidKeys : undefined}
            />
            {show && errors.itemErr && (
              <p className="mt-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2 text-xs font-medium text-[color:var(--danger)]">
                {errors.itemErr}
              </p>
            )}
            {oversold.length > 0 && (
              <div className="mt-2 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-tint)] px-3 py-2 text-xs text-ink">
                <p className="font-semibold text-[color:var(--warning)]">Not enough stock — this will go negative:</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {oversold.map((o, i) => (
                    <li key={i}>{o.label} — issuing {fmtQty(o.want)}, only {fmtQty(o.have)} on hand</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to note about this job…" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
