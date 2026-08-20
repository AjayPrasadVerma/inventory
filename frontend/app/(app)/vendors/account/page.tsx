"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { bustCache, cachedGet } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { formatDate, qty as fmtQty, rupees, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/confirm";
import { PageHeader } from "@/components/page-parts";
import { Icon } from "@/components/icons";
import { VendorForm, type Vendor } from "@/components/vendor-form";
import { PurchaseModal } from "@/components/purchase-modal";
import { PayVendorModal } from "@/components/pay-vendor-modal";

interface VendorLite { id: number; name: string; phone: string | null; city: string | null }
interface BillItem { name: string; color: string | null; unit: string; qty: string; kind: "item" | "product" }
interface PayLine { id: number; date: string; method: string | null; amount: number; advance: boolean }
interface Bill {
  id: number;
  date: string;
  bill_no: string | null;
  total: number;
  items: BillItem[];
  payments: PayLine[];
  paid: number;
  remaining: number;
}
interface Unlinked { id: number; date: string; method: string | null; amount: number; note: string | null }
interface Khata {
  opening: number;
  bills: Bill[];
  unlinked: Unlinked[];
  totals: { purchases: number; paid: number; outstanding: number };
}

type PendingDelete =
  | { kind: "purchase"; id: number; label: string }
  | { kind: "payment"; id: number; label: string };

export default function VendorAccountPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.role === "owner";

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [khata, setKhata] = useState<Khata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opens on the current month — the range a shop looks at most.
  const [from, setFrom] = useState(() => `${todayISO().slice(0, 8)}01`);
  const [to, setTo] = useState(() => todayISO());
  const [search, setSearch] = useState("");

  const [editVendor, setEditVendor] = useState(false);
  const [purchaseModal, setPurchaseModal] = useState<{ id: number | null } | null>(null);
  const [payModal, setPayModal] = useState<{ purchaseId: number; ref: string; amount?: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    cachedGet<{ data: VendorLite[] }>("/vendors/options")
      .then((r) => {
        setVendors(r.data);
        const preset = new URLSearchParams(window.location.search).get("v");
        if (preset && r.data.some((v) => String(v.id) === preset)) setVendorId(preset);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadAccount = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [v, k] = await Promise.all([
        api<{ data: Vendor }>(`/vendors/${id}`),
        api<{ data: Khata }>(`/vendors/${id}/ledger`),
      ]);
      setVendor(v.data);
      setKhata(k.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    window.history.replaceState(null, "", `?v=${vendorId}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads account data after a vendor change
    loadAccount(vendorId);
  }, [vendorId, loadAccount]);

  const refresh = useCallback(() => { if (vendorId) loadAccount(vendorId); }, [vendorId, loadAccount]);

  const vendorOptions = useMemo<ComboOption[]>(
    () => vendors.map((v) => ({ value: String(v.id), label: v.name, sublabel: [v.city, v.phone].filter(Boolean).join(" · ") || undefined })),
    [vendors],
  );

  const s = search.trim().toLowerCase();
  const hasFilter = !!(from || to || s);

  /** Bills shown after the date/search filter. Totals stay all-time so the
   *  Outstanding on this page always equals the vendor's real balance. */
  const bills = useMemo(() => {
    const all = khata?.bills ?? [];
    return all.filter((b) =>
      (!from || b.date >= from) && (!to || b.date <= to) &&
      (!s ||
        (b.bill_no ?? "").toLowerCase().includes(s) ||
        b.items.some((it) => it.name.toLowerCase().includes(s) || (it.color ?? "").toLowerCase().includes(s)) ||
        b.payments.some((p) => (p.method ?? "").toLowerCase().includes(s))),
    );
  }, [khata, from, to, s]);

  const unlinked = useMemo(() => {
    const all = khata?.unlinked ?? [];
    return all.filter((u) =>
      (!from || u.date >= from) && (!to || u.date <= to) &&
      (!s || (u.method ?? "").toLowerCase().includes(s) || (u.note ?? "").toLowerCase().includes(s)),
    );
  }, [khata, from, to, s]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteLoading(true);
    try {
      const path = pendingDelete.kind === "purchase" ? `/purchases/${pendingDelete.id}` : `/payments/${pendingDelete.id}`;
      await api(path, { method: "DELETE" });
      toast(pendingDelete.kind === "purchase" ? "Purchase deleted — stock reversed." : "Payment deleted", "success");
      setPendingDelete(null);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  function clearFilters() { setFrom(""); setTo(""); setSearch(""); }

  const billLabel = (b: Bill) => (b.bill_no ? `Bill ${b.bill_no}` : `Purchase #${b.id}`);
  const payCount = (khata?.bills ?? []).reduce((n, b) => n + b.payments.length, 0) + (khata?.unlinked.length ?? 0);

  return (
    <div className="w-full pb-10">
      <PageHeader
        backHref="/vendors"
        title={vendor?.name ?? "Vendor account"}
        subtitle={vendor ? [vendor.phone, vendor.city].filter(Boolean).join(" · ") || undefined : undefined}
        actions={vendorId ? (
          <>
            <Button variant="outline" onClick={() => setEditVendor(true)} title="Vendor details"><Icon.Edit /> <span className="hidden lg:inline">Details</span></Button>
            <Button onClick={() => setPurchaseModal({ id: null })}><Icon.Plus /> <span className="hidden sm:inline">Add purchase</span></Button>
          </>
        ) : undefined}
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <Label>Vendor</Label>
            <Combobox options={vendorOptions} value={vendorId} onChange={setVendorId} placeholder="Search vendor…" ariaLabel="Vendor" />
          </div>
          <div className="w-full sm:w-[19rem]">
            <Label>Date range</Label>
            <DateRangePicker
              from={from}
              to={to}
              onChange={(f, t) => { setFrom(f); setTo(t); }}
              disabled={!vendorId}
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Label>Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill no. / item / mode…" disabled={!vendorId} />
          </div>
          {hasFilter && <Button variant="outline" onClick={clearFilters}>Clear</Button>}
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p>}

      {!vendorId ? (
        <Card className="mt-3"><EmptyState title="Select a vendor" hint="Pick a vendor above to open its khata." /></Card>
      ) : loading ? (
        <div className="py-20 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : khata ? (
        <>
          {/* Compact money strip */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Tile label="Total purchases" value={rupees(khata.totals.purchases + khata.opening)} tone="accent" />
            <Tile label="Total paid" value={rupees(khata.totals.paid)} tone="success" />
            <Tile label="Outstanding" value={rupees(khata.totals.outstanding)} tone={khata.totals.outstanding > 0 ? "warning" : "muted"} />
          </div>

          {/* ── Bill-wise khata: goods on the left, that bill's money on the right ── */}
          <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-xs)]">
            <div className="max-h-[calc(100vh-300px)] min-h-[16rem] overflow-auto">
              <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-base">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th colSpan={3} className="border-b border-border-strong bg-surface-2 px-4 py-2.5 text-left text-sm font-semibold text-[color:var(--accent)]">
                      Purchase
                    </th>
                    <th className="border-b border-l-2 border-border-strong border-l-border-strong bg-surface-2 px-4 py-2.5 text-left text-sm font-semibold text-[color:var(--success)]">
                      Payment
                    </th>
                  </tr>
                  <tr className="text-xs uppercase tracking-[0.09em] text-muted">
                    <th className="w-24 whitespace-nowrap border-b border-border-strong bg-surface px-4 py-2 text-left font-semibold">Date</th>
                    <th className="w-32 whitespace-nowrap border-b border-border-strong bg-surface px-4 py-2 text-left font-semibold">Bill No.</th>
                    <th className="border-b border-border-strong bg-surface px-4 py-2 text-left font-semibold">Items</th>
                    <th className="w-[38%] whitespace-nowrap border-b border-l-2 border-border-strong border-l-border-strong bg-surface px-4 py-2 text-left font-semibold">
                      Total · paid · remaining
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {bills.map((b) => {
                    const settled = b.remaining <= 0 && b.total > 0;
                    const cell = `border-b border-border-strong px-4 py-2.5 align-top ${settled ? "bg-[color:var(--success-tint)]" : ""}`;
                    return (
                      <tr key={b.id}>
                        <td className={`${cell} whitespace-nowrap font-mono text-sm font-semibold text-muted`}>{formatDate(b.date)}</td>
                        <td className={cell}>
                          <span className="whitespace-nowrap font-mono text-[15px] font-semibold text-ink">{b.bill_no || `#${b.id}`}</span>
                          <span className="mt-1 flex gap-3 text-[13px]">
                            <button onClick={() => setPurchaseModal({ id: b.id })} className="cursor-pointer text-muted underline-offset-2 hover:text-ink hover:underline">Edit</button>
                            {isOwner && (
                              <button onClick={() => setPendingDelete({ kind: "purchase", id: b.id, label: billLabel(b) })} className="cursor-pointer text-muted underline-offset-2 hover:text-[color:var(--danger)] hover:underline">Delete</button>
                            )}
                          </span>
                        </td>
                        <td className={`${cell} text-[15px] font-medium`}>
                          {b.items.length === 0 ? <span className="text-muted">—</span> : (
                            <>
                              {b.items.length > 3 && (
                                <span className="mb-1.5 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                                  {b.items.length} items
                                </span>
                              )}
                              <div className={b.items.length > 3 ? "columns-2 gap-x-8" : undefined}>
                                {b.items.map((it, k) => (
                                  <span key={k} className="block break-inside-avoid">
                                    {it.name}
                                    {it.color ? <span className="text-muted"> ({it.color})</span> : null}
                                    <span className="text-muted"> · {fmtQty(it.qty)} {it.unit}</span>
                                    {it.kind === "product" && (
                                      <span className="ml-1.5 rounded bg-[color:var(--success-tint)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[color:var(--success)]">
                                        Finished
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </td>
                        <td className={`border-b border-l-2 border-border-strong border-l-border-strong px-4 py-2.5 align-top ${settled ? "bg-[color:var(--success-tint)]" : ""}`}>
                          <MoneyBox
                            settled={settled}
                            total={b.total}
                            payments={b.payments}
                            remaining={b.remaining}
                            onPay={() => setPayModal({ purchaseId: b.id, ref: billLabel(b), amount: b.remaining > 0 ? b.remaining : undefined })}
                            onDeletePay={isOwner ? (p) => setPendingDelete({ kind: "payment", id: p.id, label: `${rupees(p.amount)} on ${formatDate(p.date)}` }) : undefined}
                          />
                        </td>
                      </tr>
                    );
                  })}

                  {/* Money paid with no bill attached — still reduces what the vendor is owed. */}
                  {unlinked.map((u) => (
                    <tr key={`u${u.id}`}>
                      <td className="border-b border-border-strong px-4 py-2.5 align-top font-mono text-sm font-semibold text-muted">{formatDate(u.date)}</td>
                      <td className="border-b border-border-strong px-4 py-2.5 align-top font-mono text-[15px] font-semibold text-muted">—</td>
                      <td className="border-b border-border-strong px-4 py-2.5 align-top text-[15px] font-medium text-muted">
                        On-account payment{u.note ? ` · ${u.note}` : ""}
                      </td>
                      <td className="border-b border-l-2 border-border-strong border-l-border-strong px-4 py-2.5 align-top">
                        <div className="w-full">
                          <PayRow line={{ id: u.id, date: u.date, method: u.method, amount: u.amount, advance: false }}
                            onDelete={isOwner ? () => setPendingDelete({ kind: "payment", id: u.id, label: `${rupees(u.amount)} on ${formatDate(u.date)}` }) : undefined} />
                        </div>
                      </td>
                    </tr>
                  ))}

                  {bills.length === 0 && unlinked.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">
                      No purchases{hasFilter ? " match these filters" : " yet"}.
                    </td></tr>
                  )}
                </tbody>

                <tfoot>
                  <tr>
                    <td colSpan={3} className="border-t border-border-strong bg-surface-2 px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted">
                      {bills.length < khata.bills.length ? `${bills.length} of ${khata.bills.length}` : khata.bills.length} bills · {payCount} payments
                      {khata.opening > 0 && <> · opening {rupees(khata.opening)}</>}
                    </td>
                    <td className="border-l-2 border-t border-border-strong border-l-border-strong bg-surface-2 px-4 py-2.5">
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        <Total label="Purchases" value={rupees(khata.totals.purchases + khata.opening)} />
                        <Total label="Paid" value={rupees(khata.totals.paid)} className="text-[color:var(--success)]" />
                        <Total label="Outstanding" value={rupees(khata.totals.outstanding)} className="text-[color:var(--warning)]" />
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {editVendor && vendor && (
        <VendorForm
          vendor={vendor}
          onClose={() => setEditVendor(false)}
          onSaved={() => { setEditVendor(false); bustCache("/vendors/options"); refresh(); }}
        />
      )}

      {purchaseModal && vendor && (
        <PurchaseModal
          vendorId={vendor.id}
          vendorName={vendor.name}
          purchaseId={purchaseModal.id}
          onClose={() => setPurchaseModal(null)}
          onDone={() => { setPurchaseModal(null); refresh(); }}
        />
      )}

      {payModal && vendor && (
        <PayVendorModal
          vendorId={vendor.id}
          vendorName={vendor.name}
          purchaseId={payModal.purchaseId}
          againstRef={payModal.ref}
          suggestAmount={payModal.amount}
          onClose={() => setPayModal(null)}
          onDone={() => { setPayModal(null); refresh(); }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === "purchase" ? "Delete purchase?" : "Delete payment?"}
        message={
          pendingDelete?.kind === "purchase"
            ? <>Deleting <span className="font-semibold text-ink">{pendingDelete.label}</span> will reverse the raw material stock it added and any payment made against it. This cannot be undone.</>
            : <>Delete the payment of <span className="font-semibold text-ink">{pendingDelete?.label}</span>? This cannot be undone.</>
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** One bill's whole money story: total, when/how much was paid, what's left. */
function MoneyBox({
  settled, total, payments, remaining, onPay, onDeletePay,
}: {
  settled: boolean;
  total: number;
  payments: PayLine[];
  remaining: number;
  onPay: () => void;
  onDeletePay?: (p: PayLine) => void;
}) {
  // Dotted rules separate total → each payment → remaining. On a settled (green)
  // row they take a green tone so they don't read as harsh grey on the tint.
  const rule = `border-b border-dotted ${settled ? "border-[color:var(--success)]/45" : "border-border-strong"}`;

  return (
    <div className="flex h-full w-full flex-col">
      <div className={`flex items-baseline justify-between gap-3 pb-1 ${rule}`}>
        <span className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Total</span>
        <span className="font-mono text-base font-bold tabular-nums text-ink">{rupees(total)}</span>
      </div>

      {payments.length === 0 ? (
        <div className={`flex items-center justify-between gap-3 py-1 ${rule}`}>
          <span className="text-sm font-medium text-muted">No payment yet</span>
          <button onClick={onPay} className="cursor-pointer rounded-md bg-[color:var(--success-tint)] px-3 py-1 text-sm font-medium text-[color:var(--success)] transition-colors hover:bg-[color:var(--success)] hover:text-white">Pay</button>
        </div>
      ) : (
        payments.map((p, i) => (
          <PayRow
            key={`${p.id}-${i}`}
            line={p}
            rule={rule}
            onDelete={onDeletePay && p.id > 0 ? () => onDeletePay(p) : undefined}
          />
        ))
      )}

      <div className="flex items-baseline justify-between gap-3 pt-1">
        <span className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Remaining</span>
        {settled ? (
          <span className="text-[13px] font-bold uppercase tracking-wide text-[color:var(--success)]">Fully paid</span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-base font-bold tabular-nums text-[color:var(--warning)]">{rupees(remaining)}</span>
            {payments.length > 0 && (
              <button onClick={onPay} className="cursor-pointer rounded-md bg-[color:var(--success-tint)] px-2.5 py-1 text-[13px] font-medium text-[color:var(--success)] transition-colors hover:bg-[color:var(--success)] hover:text-white">Pay</button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** date · mode · amount — one payment. Delete stays hidden until hover to keep the box quiet. */
function PayRow({ line, onDelete, rule }: { line: PayLine; onDelete?: () => void; rule?: string }) {
  return (
    <div className={`group grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-2.5 py-1 ${rule ?? ""}`}>
      <span className="font-mono text-[13.5px] font-semibold text-muted">{formatDate(line.date)}</span>
      <span className="text-sm font-medium text-ink">{line.advance ? <span className="text-muted">Advance on bill</span> : (line.method || "—")}</span>
      <span className="font-mono text-[14.5px] font-bold tabular-nums text-[color:var(--success)]">{rupees(line.amount)}</span>
      {onDelete ? (
        <button onClick={onDelete} aria-label="Delete payment" className="cursor-pointer text-[13px] text-muted opacity-0 transition-opacity hover:text-[color:var(--danger)] group-hover:opacity-100">✕</button>
      ) : <span />}
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  accent: "bg-[color:var(--accent-tint)] text-[color:var(--accent)]",
  success: "bg-[color:var(--success-tint)] text-[color:var(--success)]",
  warning: "bg-[color:var(--warning-tint)] text-[color:var(--warning)]",
  muted: "bg-surface-2 text-muted",
};

function Tile({ label, value, tone }: { label: string; value: string; tone: keyof typeof TILE_TONE }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-1.5 ${TILE_TONE[tone]}`}>
      <span className="truncate text-[13px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="shrink-0 text-[17px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Total({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-[17px] font-semibold tabular-nums ${className ?? "text-ink"}`}>{value}</span>
    </span>
  );
}
