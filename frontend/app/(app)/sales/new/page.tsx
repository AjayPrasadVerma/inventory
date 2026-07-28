"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { rupees, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Card, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import {
  PricedRows, blankPricedLine, pricedLineStatus, pricedTotal,
  type PricedItemOpt, type PricedLine,
} from "@/components/material-rows";

interface RawProduct {
  id: number;
  name: string;
  variant_options: { id: number; variant: string }[];
}
interface FinStock { product_id: number; variant_id: number | null; on_hand: string }

const stockKey = (productId: number, variantId: number | null) => `${productId}:${variantId ?? 0}`;

export default function NewSalePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [products, setProducts] = useState<PricedItemOpt[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"retail" | "wholesale">("retail");
  const [date, setDate] = useState(todayISO());
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit">("cash");
  const [received, setReceived] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PricedLine[]>([blankPricedLine()]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [foundExisting, setFoundExisting] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const id = new URLSearchParams(window.location.search).get("edit");
      setEditId(id);
      const r = await cachedGet<{ data: RawProduct[] }>("/products/options");
      setProducts(r.data.map((p) => ({ id: p.id, name: p.name, variants: p.variant_options.map((v) => ({ id: v.id, label: v.variant })) })));
      // Finished-goods on-hand, for the oversell warning (soft — never blocks saving).
      const st = await cachedGet<{ data: FinStock[] }>("/reports/finished-stock");
      const map: Record<string, number> = {};
      for (const s of st.data) map[stockKey(s.product_id, s.variant_id)] = Number(s.on_hand);
      setStock(map);
      if (id) {
        const res = await api<{ data: {
          type: "retail" | "wholesale"; sale_date: string; customer_name: string | null; customer_mobile: string | null;
          items: { product_id: number; variant_id: number | null; product_name: string; variant: string | null; qty: string; price: string }[];
        } }>(`/sales/${id}`);
        const s = res.data;
        setMobile(s.customer_mobile ?? "");
        setName(s.customer_name ?? "");
        setType(s.type);
        setDate(s.sale_date);
        setLines(
          (s.items ?? []).map((it) => ({
            ...blankPricedLine(),
            itemId: String(it.product_id),
            variantId: it.variant_id ? String(it.variant_id) : "",
            qty: String(it.qty),
            money: String(it.price),
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

  useEffect(() => {
    if (editId) return;
    const m = mobile.trim();
    const t = setTimeout(() => {
      if (m.length < 4) { setFoundExisting(false); return; }
      api<{ data: { name: string | null; type: "retail" | "wholesale" } | null }>("/customers/lookup", { params: { mobile: m } })
        .then((r) => {
          if (r.data) {
            setFoundExisting(true);
            if (r.data.name) setName(r.data.name);
            setType(r.data.type);
          } else setFoundExisting(false);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [mobile, editId]);

  const total = pricedTotal(lines);

  const errors = useMemo(() => {
    const invalidKeys = new Set<number>();
    let productErr: string | undefined;
    let receivedErr: string | undefined;

    let complete = 0;
    for (const l of lines) {
      const st = pricedLineStatus(l, false);
      if (st === "invalid") invalidKeys.add(l.key);
      if (st === "complete") complete++;
    }
    if (invalidKeys.size > 0) productErr = "Some rows are incomplete — each needs a product and a quantity greater than 0.";
    else if (complete === 0) productErr = "Add at least one product with a quantity.";

    if (paymentMode === "credit") {
      const rStr = received.trim();
      if (rStr !== "") {
        const n = Number(rStr);
        if (!Number.isFinite(n) || n < 0) receivedErr = "Enter a valid amount (0 or more).";
        else if (n > total) receivedErr = "Received cannot be more than the total.";
      }
    }

    return { invalidKeys, productErr, receivedErr, hasError: !!(productErr || receivedErr) };
  }, [lines, paymentMode, received, total]);

  const show = submitted;

  async function save() {
    setSubmitted(true);
    if (errors.hasError) { toast("Please fix the highlighted fields.", "error"); return; }

    const items = lines
      .filter((l) => pricedLineStatus(l, false) === "complete")
      .map((l) => ({ product_id: Number(l.itemId), variant_id: l.variantId ? Number(l.variantId) : null, qty: Number(l.qty), price: Number(l.money) || 0 }));

    // Soft oversell warning — total requested per product/variant vs on-hand. Never blocks.
    if (!editId) {
      const reqByKey = new Map<string, number>();
      for (const it of items) {
        const k = stockKey(it.product_id, it.variant_id);
        reqByKey.set(k, (reqByKey.get(k) ?? 0) + it.qty);
      }
      const oversold = items
        .filter((it, i) => items.findIndex((x) => stockKey(x.product_id, x.variant_id) === stockKey(it.product_id, it.variant_id)) === i)
        .map((it) => {
          const k = stockKey(it.product_id, it.variant_id);
          const need = reqByKey.get(k) ?? 0;
          const have = stock[k] ?? 0;
          const p = products.find((x) => x.id === it.product_id);
          const vlabel = it.variant_id ? p?.variants.find((v) => v.id === it.variant_id)?.label : "";
          return { label: `${p?.name ?? "Product"}${vlabel ? ` (${vlabel})` : ""}`, need, have };
        })
        .filter((o) => o.need > o.have);
      if (oversold.length > 0) {
        const detail = oversold.map((o) => `• ${o.label}: selling ${o.need}, only ${o.have} in stock`).join("\n");
        if (!confirm(`Not enough stock for:\n\n${detail}\n\nStock will go negative (oversold). Save anyway?`)) return;
      }
    }

    setSaving(true);
    try {
      if (editId) {
        await api(`/sales/${editId}`, {
          method: "PATCH",
          body: { type, sale_date: date, items },
        });
        toast("Sale updated", "success");
      } else {
        await api("/sales", {
          method: "POST",
          body: {
            mobile: mobile.trim() || null,
            customer_name: name.trim() || null,
            type,
            sale_date: date,
            payment_mode: paymentMode,
            amount_received: paymentMode === "credit" ? Number(received) || 0 : total,
            notes: notes.trim() || null,
            items,
          },
        });
        toast("Sale saved — stock updated.", "success");
      }
      router.push("/sales");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full pb-24">
      <PageHeader backHref="/sales" title={editId ? "Edit Sale" : "New Sale"} subtitle="Retail / wholesale — finished goods go out of stock." />

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
          <Card className="p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Mobile" hint={foundExisting ? "Existing customer" : "Auto-creates the customer"}>
                <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" placeholder="Optional" />
              </Field>
              <Field label="Customer name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk-in" />
              </Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as "retail" | "wholesale")}>
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                </Select>
              </Field>
              <Field label="Date">
                <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Date" />
              </Field>
            </div>
          </Card>

          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">Products sold</h2>
            <PricedRows
              options={products}
              lines={lines}
              setLines={setLines}
              moneyLabel="Price"
              primaryLabel="Product"
              primaryPlaceholder="Search product…"
              invalidKeys={show ? errors.invalidKeys : undefined}
            />
            {show && errors.productErr && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2 text-xs font-medium text-[color:var(--danger)]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
                </svg>
                {errors.productErr}
              </div>
            )}
          </div>

          <Card className="mt-4 p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Payment">
                <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "cash" | "credit")}>
                  <option value="cash">Cash (full)</option>
                  <option value="credit">Credit (udhaar)</option>
                </Select>
              </Field>
              {paymentMode === "credit" && (
                <Field label="Received now" hint="The rest stays as balance" error={show ? errors.receivedErr : undefined}>
                  <Input value={received} onChange={(e) => setReceived(e.target.value)} inputMode="decimal" placeholder="0" invalid={show && !!errors.receivedErr} />
                </Field>
              )}
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to note about this sale…" />
              </Field>
            </div>
          </Card>

          <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 border-t border-border bg-background/85 py-3 backdrop-blur-sm">
            <span className="mr-auto text-sm">
              <span className="text-muted">Total: </span>
              <span className="text-base font-semibold text-ink tabular-nums">{rupees(total)}</span>
            </span>
            <Button variant="outline" onClick={() => router.push("/sales")} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <><Spinner /> Saving…</> : "Save Sale"}</Button>
          </div>
        </>
      )}
    </div>
  );
}
