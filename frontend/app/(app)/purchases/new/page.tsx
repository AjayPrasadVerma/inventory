"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { rupees, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { Card, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import {
  PricedRows, blankPricedLine, pricedLineStatus, pricedTotal,
  type PricedItemOpt, type PricedLine,
} from "@/components/material-rows";

interface VendorOpt { id: number; name: string; phone?: string | null }
interface RawItem {
  id: number;
  name: string;
  units: string[];
  variant_options: { id: number; color: string }[];
}

export default function NewPurchasePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [items, setItems] = useState<PricedItemOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PricedLine[]>([blankPricedLine()]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const id = new URLSearchParams(window.location.search).get("edit"); // guards-allow: reached only by a fresh navigation from the purchases list; nothing links here from this same route
      setEditId(id);
      const [v, i] = await Promise.all([
        cachedGet<{ data: VendorOpt[] }>("/vendors/options"),
        cachedGet<{ data: RawItem[] }>("/items/options"),
      ]);
      setVendors(v.data);
      setItems(i.data.map((it) => ({ id: it.id, name: it.name, units: it.units, variants: it.variant_options.map((c) => ({ id: c.id, label: c.color })) })));
      if (id) {
        const res = await api<{ data: {
          vendor_id: number; bill_no: string | null; purchase_date: string; vendor_name: string;
          items: { item_id: number; variant_id: number | null; item_name: string; color: string | null; unit: string; qty: string; rate: string }[];
        } }>(`/purchases/${id}`);
        const p = res.data;
        setVendorId(String(p.vendor_id));
        setBillNo(p.bill_no ?? "");
        setDate(p.purchase_date);
        setLines(
          (p.items ?? []).map((it) => ({
            ...blankPricedLine(),
            itemId: String(it.item_id),
            variantId: it.variant_id ? String(it.variant_id) : "",
            unit: it.unit,
            qty: String(it.qty),
            money: String(it.rate),
          })),
        );
      }
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Could not load form data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state is set only after await
  useEffect(() => { loadOptions(); }, [loadOptions]);

  function retry() { setLoading(true); setLoadError(null); loadOptions(); }

  const vendorOptions = useMemo<ComboOption[]>(
    () => vendors.map((v) => ({ value: String(v.id), label: v.name, sublabel: v.phone || undefined })),
    [vendors],
  );
  const total = pricedTotal(lines);

  const errors = useMemo(() => {
    const invalidKeys = new Set<number>();
    let vendorErr: string | undefined;
    let itemErr: string | undefined;

    if (!vendorId) vendorErr = "Please select a vendor.";

    let complete = 0;
    for (const l of lines) {
      const st = pricedLineStatus(l, true);
      if (st === "invalid") invalidKeys.add(l.key);
      if (st === "complete") complete++;
    }
    if (invalidKeys.size > 0) itemErr = "Some rows are incomplete — each needs an item, a unit, and a quantity greater than 0.";
    else if (complete === 0) itemErr = "Add at least one item with a quantity.";

    return { invalidKeys, vendorErr, itemErr, hasError: !!(vendorErr || itemErr) };
  }, [vendorId, lines]);

  const show = submitted;

  async function save() {
    setSubmitted(true);
    if (errors.hasError) { toast("Please fix the highlighted fields.", "error"); return; }
    setSaving(true);
    try {
      const items = lines
        .filter((l) => pricedLineStatus(l, true) === "complete")
        .map((l) => ({
          item_id: Number(l.itemId),
          variant_id: l.variantId ? Number(l.variantId) : null,
          unit: l.unit,
          qty: Number(l.qty),
          rate: Number(l.money) || 0,
        }));
      const base = {
        vendor_id: Number(vendorId),
        bill_no: billNo.trim() || null,
        purchase_date: date,
        items,
      };
      if (editId) {
        await api(`/purchases/${editId}`, { method: "PATCH", body: base });
        toast("Purchase updated", "success");
      } else {
        await api("/purchases", { method: "POST", body: { ...base, notes: notes.trim() || null } });
        toast("Purchase saved — stock updated.", "success");
      }
      router.push("/purchases");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full pb-24">
      <PageHeader backHref="/purchases" title={editId ? "Edit Purchase" : "New Purchase"} subtitle="Raw material received from a vendor — stock updates automatically." />

      {loading ? (
        <Card className="flex items-center justify-center gap-3 p-12 text-sm text-muted"><Spinner /> Loading form…</Card>
      ) : loadError ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm font-medium text-ink">Could not load the form.</p>
          <p className="max-w-md text-sm text-muted">{loadError}</p>
          <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
        </Card>
      ) : (
        <>
          {vendors.length === 0 && (
            <div className="mb-4 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-tint)] px-4 py-3 text-sm text-ink">
              No vendors found. <Link href="/vendors" className="font-medium underline">Add a vendor</Link> first.
            </div>
          )}

          <Card className="p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <Field label="Vendor *" error={show ? errors.vendorErr : undefined}>
                  <Combobox options={vendorOptions} value={vendorId} onChange={setVendorId} placeholder="Search vendor…" invalid={show && !!errors.vendorErr} ariaLabel="Vendor" />
                </Field>
              </div>
              <Field label="Date">
                <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Date" />
              </Field>
              <Field label="Bill No. (optional)">
                <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. INV-1042" />
              </Field>
            </div>
          </Card>

          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">Items purchased</h2>
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
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2 text-xs font-medium text-[color:var(--danger)]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
                </svg>
                {errors.itemErr}
              </div>
            )}
          </div>

          <Card className="mt-4 p-5">
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to note about this purchase…" />
            </Field>
          </Card>

          <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 border-t border-border bg-background/85 py-3 backdrop-blur-sm">
            <span className="mr-auto text-sm">
              <span className="text-muted">Total: </span>
              <span className="text-base font-semibold text-ink tabular-nums">{rupees(total)}</span>
            </span>
            <Button variant="outline" onClick={() => router.push("/purchases")} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || vendors.length === 0}>{saving ? <><Spinner /> Saving…</> : "Save Purchase"}</Button>
          </div>
        </>
      )}
    </div>
  );
}
