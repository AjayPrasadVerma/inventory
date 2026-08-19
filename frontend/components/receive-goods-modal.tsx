"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { PAY_METHODS } from "@/components/pay-vendor-modal";
import {
  MaterialRows, ProductRows, blankMaterial, blankProduct,
  materialPayload, productPayload,
  type ItemOpt, type MaterialLine, type ProductOpt, type ProductLine,
} from "@/components/material-rows";

/**
 * Take finished goods back from a karigar for one job — plus any left-over raw
 * material returned, and the money paid at that moment. All three land in the
 * same request so goods and money can't drift apart.
 */
export function ReceiveGoodsModal({
  jobId,
  karigarName,
  onClose,
  onDone,
}: {
  jobId: number;
  karigarName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [made, setMade] = useState<ProductLine[]>([blankProduct()]);
  const [returns, setReturns] = useState<MaterialLine[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([
        cachedGet<{ data: ProductOpt[] }>("/products/options"),
        cachedGet<{ data: ItemOpt[] }>("/items/options"),
      ]);
      setProducts(p.data);
      setItems(i.data);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state is set only after await
  useEffect(() => { load(); }, [load]);

  const receipts = useMemo(() => productPayload(made), [made]);
  const returned = useMemo(() => materialPayload(returns), [returns]);
  const pay = Number(amount) || 0;

  const err = useMemo(() => {
    if (receipts.length === 0 && returned.length === 0 && pay <= 0) {
      return "Add the goods received, a returned material, or a payment.";
    }
    return undefined;
  }, [receipts.length, returned.length, pay]);

  async function save() {
    setSubmitted(true);
    if (err) { toast(err, "error"); return; }
    setSaving(true);
    try {
      await api(`/jobs/${jobId}/receipt`, {
        method: "POST",
        body: {
          receipts,
          returns: returned,
          on_date: date,
          payment: pay > 0 ? { amount: pay, method } : undefined,
        },
      });
      toast("Goods received — finished stock updated.", "success");
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
      size="page"
      title={`Receive goods — Job #${jobId} · ${karigarName}`}
      footer={(close) => (
        <>
          <span className="mr-auto text-sm text-muted">
            {receipts.length} product{receipts.length === 1 ? "" : "s"}
            {returned.length > 0 ? ` · ${returned.length} returned` : ""}
            {pay > 0 ? ` · paying ₹${pay.toLocaleString("en-IN")}` : ""}
          </span>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || !!loadError}>
            {saving ? <Spinner /> : "Receive goods"}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date">
              <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Receive date" />
            </Field>
            <Field label="Paid now (₹, optional)">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Mode">
              <Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={pay <= 0}>
                {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Goods received (aaya)</h3>
            <ProductRows products={products} lines={made} setLines={setMade} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Material returned (optional)</h3>
              {returns.length === 0 && (
                <Button variant="outline" size="sm" onClick={() => setReturns([blankMaterial()])}>
                  Add returned material
                </Button>
              )}
            </div>
            {returns.length > 0 && <MaterialRows items={items} lines={returns} setLines={setReturns} />}
          </div>

          {submitted && err && (
            <p className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2 text-xs font-medium text-[color:var(--danger)]">
              {err}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
