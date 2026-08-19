"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { rupees, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import {
  PricedRows, blankPricedLine, pricedLineStatus, pricedTotal,
  type PricedItemOpt, type PricedLine,
} from "@/components/material-rows";

interface RawItem {
  id: number;
  name: string;
  units: string[];
  variant_options: { id: number; color: string }[];
}

/** Add or edit a purchase for ONE vendor, straight from the vendor's account page. */
export function PurchaseModal({
  vendorId,
  vendorName,
  purchaseId,
  onClose,
  onDone,
}: {
  vendorId: number;
  vendorName: string;
  /** null → create a new purchase; number → edit that purchase. */
  purchaseId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<PricedItemOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [billNo, setBillNo] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PricedLine[]>([blankPricedLine()]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const i = await cachedGet<{ data: RawItem[] }>("/items/options");
      const opts = i.data.map((it) => ({
        id: it.id,
        name: it.name,
        units: it.units,
        variants: it.variant_options.map((c) => ({ id: c.id, label: c.color })),
      }));
      if (purchaseId) {
        const res = await api<{ data: {
          bill_no: string | null; purchase_date: string; notes: string | null;
          items: { item_id: number; variant_id: number | null; unit: string; qty: string; rate: string }[];
        } }>(`/purchases/${purchaseId}`);
        const p = res.data;
        setBillNo(p.bill_no ?? "");
        setDate(p.purchase_date);
        setNotes(p.notes ?? "");
        setLines((p.items ?? []).map((it) => ({
          ...blankPricedLine(),
          itemId: String(it.item_id),
          variantId: it.variant_id ? String(it.variant_id) : "",
          unit: it.unit,
          qty: String(Number(it.qty)),
          money: String(Number(it.rate)),
        })));
      }
      setItems(opts);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Could not load the form.");
    } finally {
      setLoading(false);
    }
  }, [purchaseId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state is set only after await
  useEffect(() => { load(); }, [load]);

  const total = pricedTotal(lines);

  const errors = useMemo(() => {
    const invalidKeys = new Set<number>();
    let itemErr: string | undefined;
    let complete = 0;
    for (const l of lines) {
      const st = pricedLineStatus(l, true);
      if (st === "invalid") invalidKeys.add(l.key);
      if (st === "complete") complete++;
    }
    if (invalidKeys.size > 0) itemErr = "Some rows are incomplete — each needs an item, a unit, and a quantity greater than 0.";
    else if (complete === 0) itemErr = "Add at least one item with a quantity.";
    return { invalidKeys, itemErr, hasError: !!itemErr };
  }, [lines]);

  async function save() {
    setSubmitted(true);
    if (errors.hasError) { toast("Please fix the highlighted rows.", "error"); return; }
    setSaving(true);
    try {
      const payloadItems = lines
        .filter((l) => pricedLineStatus(l, true) === "complete")
        .map((l) => ({
          item_id: Number(l.itemId),
          variant_id: l.variantId ? Number(l.variantId) : null,
          unit: l.unit,
          qty: Number(l.qty),
          rate: Number(l.money) || 0,
        }));
      const base = {
        vendor_id: vendorId,
        bill_no: billNo.trim() || null,
        purchase_date: date,
        items: payloadItems,
      };
      if (purchaseId) {
        await api(`/purchases/${purchaseId}`, { method: "PATCH", body: base });
        toast("Purchase updated — stock adjusted.", "success");
      } else {
        await api("/purchases", { method: "POST", body: { ...base, notes: notes.trim() || null } });
        toast("Purchase saved — stock updated.", "success");
      }
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
      size="xl"
      title={purchaseId ? `Edit purchase — ${vendorName}` : `New purchase — ${vendorName}`}
      footer={(close) => (
        <>
          <span className="mr-auto text-sm">
            <span className="text-muted">Total: </span>
            <span className="text-base font-semibold tabular-nums text-ink">{rupees(total)}</span>
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || !!loadError}>
            {saving ? <Spinner /> : purchaseId ? "Save changes" : "Save purchase"}
          </Button>
        </>
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted"><Spinner /> Loading…</div>
      ) : loadError ? (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-ink">Could not load the form.</p>
          <p className="mt-1 text-sm text-muted">{loadError}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date">
              <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Purchase date" />
            </Field>
            <Field label="Bill No. (optional)">
              <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. INV-1042" />
            </Field>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Items purchased</h3>
            <PricedRows
              options={items}
              lines={lines}
              setLines={setLines}
              withUnit
              moneyLabel="Rate"
              primaryLabel="Item"
              primaryPlaceholder="Search item…"
              variantPlaceholder="Color…"
              invalidKeys={show ? errors.invalidKeys : undefined}
            />
            {show && errors.itemErr && (
              <p className="mt-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2 text-xs font-medium text-[color:var(--danger)]">
                {errors.itemErr}
              </p>
            )}
          </div>

          {!purchaseId && (
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to note about this purchase…" />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
