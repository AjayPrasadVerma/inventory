"use client";

/**
 * ⚠️  UNUSED — SALE / CUSTOMER MODULE, NOT PART OF THE CURRENT SCOPE
 *
 * The app is inventory-only right now. Sale and Customers are hidden from the
 * menu (see components/app-shell.tsx) and the owner has said no work is to be
 * done here. This file is kept, not deleted, so billing can be switched back on
 * later without rebuilding it — the routes, tables and data are all intact.
 *
 * Do not extend, refactor or "tidy" this file. If a change here looks necessary,
 * ask first: it almost certainly means something outside the module is wrong.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { formatDate, qty as fmtQty, rupees, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";

interface CustomerLite { id: number; name: string | null; mobile: string | null; balance: string }
interface LedgerItem { name: string; variant: string | null; qty: string }
interface LedgerData {
  entries: { date: string; type: "sale" | "payment"; ref: string; credit: number; debit: number; items?: LedgerItem[] }[];
}

export default function CustomerAccountPage() {
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const router = useRouter();
  const params = useSearchParams();
  // The record on screen comes from the URL, not from local state: the command
  // palette navigates by changing only ?c=, which does not remount this segment,
  // so anything read once on mount would ignore it.
  const customerId = params.get("c") ?? "";
  const setCustomerId = useCallback(
    (id: string) => router.replace(id ? `?c=${id}` : "?", { scroll: false }),
    [router],
  );
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters — default to the current month (1st → today)
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayISO());
  const [type, setType] = useState<"all" | "sale" | "payment">("all");
  const [search, setSearch] = useState("");

  // Load the customer list once and honour a ?c=<id> pre-selection (set inside the
  // resolved promise so no state is set synchronously during the effect).
  useEffect(() => {
    cachedGet<{ data: CustomerLite[] }>("/customers/options")
      .then((r) => {
        setCustomers(r.data);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadAccount = useCallback((id: string) => {
    let alive = true;
    setLoading(true);
    setError(null);
    api<{ data: LedgerData }>(`/customers/${id}/ledger`)
      .then((l) => { if (alive) setLedger(l.data); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!customerId) return; // render guards on !customerId, so stale data is never shown
    // Keep the URL shareable/refresh-safe without a full navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads account data after a customer change
    return loadAccount(customerId);
  }, [customerId, loadAccount]);

  const customerOptions = useMemo<ComboOption[]>(
    () => customers.map((c) => ({ value: String(c.id), label: c.name || c.mobile || "Customer", sublabel: c.mobile || undefined })),
    [customers],
  );
  const hasFilter = !!(from || to || type !== "all" || search.trim());
  const s = search.trim().toLowerCase();
  const statsReady = !loading && !!ledger;

  const shownLedger = useMemo(() => {
    if (!ledger) return [] as LedgerData["entries"];
    return ledger.entries.filter((e) =>
      (!from || e.date >= from) && (!to || e.date <= to) &&
      (type === "all" || e.type === type) &&
      (!s || e.ref.toLowerCase().includes(s)),
    );
  }, [ledger, from, to, type, s]);

  // KPIs + product breakdown — derived from the FILTERED rows so they match the
  // date range / type / search shown in the table (not all-time).
  const stats = useMemo(() => {
    if (!ledger) return null;
    let sales = 0, received = 0;
    const prodMap = new Map<string, { name: string; variant: string | null; qty: number }>();
    for (const e of shownLedger) {
      if (e.type === "sale") {
        sales++;
        for (const it of e.items ?? []) {
          const key = `${it.name}|${it.variant ?? ""}`;
          const cur = prodMap.get(key) ?? { name: it.name, variant: it.variant, qty: 0 };
          cur.qty += Number(it.qty) || 0;
          prodMap.set(key, cur);
        }
      }
      received += e.debit;
    }
    const products = [...prodMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { sales, received, products };
  }, [ledger, shownLedger]);

  function clearFilters() { setFrom(""); setTo(""); setType("all"); setSearch(""); }

  return (
    <div className="w-full pb-16">
      <PageHeader backHref="/customers" title="Customer Account" subtitle="Sales and receipts in one place." />

      {/* Top: small uniform KPI tiles — sales, received, then one tile per product sold */}
      <div className="mb-4 grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
        <div className="rounded-[14px] border border-border bg-primary-tint px-3 py-2 shadow-[var(--shadow-xs)]">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-primary">Total Sales</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{statsReady && stats ? stats.sales : "—"}</p>
        </div>
        <div className="rounded-[14px] border border-border bg-[color:var(--success-tint)] px-3 py-2 shadow-[var(--shadow-xs)]">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[color:var(--success)]">Received</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[color:var(--success)]">{statsReady && stats ? rupees(stats.received) : "—"}</p>
        </div>
        {statsReady && stats && stats.products.map((p, i) => {
          const tint = ["bg-[color:var(--accent-tint)]", "bg-primary-tint", "bg-[color:var(--success-tint)]", "bg-[color:var(--warning-tint)]"][i % 4];
          return (
            <div key={i} className={`rounded-[14px] border border-border px-3 py-2 shadow-[var(--shadow-xs)] ${tint}`}>
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted" title={`${p.name}${p.variant ? ` (${p.variant})` : ""}`}>
                {p.name}{p.variant ? ` (${p.variant})` : ""}
              </p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">
                {fmtQty(p.qty)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Toolbar: customer picker + filters in one row */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <Label>Customer</Label>
            <Combobox options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="Search customer…" ariaLabel="Customer" />
          </div>
          <div className="w-36">
            <Label>From</Label>
            <DateField value={from} onChange={setFrom} disabled={!customerId} ariaLabel="From date" />
          </div>
          <div className="w-36">
            <Label>To</Label>
            <DateField value={to} onChange={setTo} min={from || undefined} disabled={!customerId} ariaLabel="To date" />
          </div>
          <div className="w-36">
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={!customerId}>
              <option value="all">All entries</option>
              <option value="sale">Sales</option>
              <option value="payment">Receipts</option>
            </Select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label>Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill no. / reference…" disabled={!customerId} />
          </div>
          {hasFilter && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>
      </Card>

      {error && <p className="mt-4 text-sm text-[color:var(--danger)]">{error}</p>}

      {!customerId ? (
        <Card className="mt-4"><EmptyState title="Select a customer" hint="Pick a customer above to see its ledger and sales history." /></Card>
      ) : loading ? (
        <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : ledger ? (
        <section className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">Ledger &amp; history</h2>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="max-h-[62vh] overflow-auto">
                <table className="data-table sticky-head min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Details</th><th>Items sold</th>
                      <th className="num">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownLedger.map((e, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap text-muted">{formatDate(e.date)}</td>
                        <td>
                          <Badge tone={e.type === "sale" ? "accent" : "success"}>
                            {e.type === "sale" ? "Sale" : "Receipt"}
                          </Badge>
                        </td>
                        <td className="text-ink">{e.ref}</td>
                        <td className="text-muted">
                          {e.items && e.items.length > 0
                            ? e.items.map((it) => `${it.name}${it.variant ? ` (${it.variant})` : ""} · ${fmtQty(it.qty)}`).join(",  ")
                            : "—"}
                        </td>
                        <td className="num">{e.debit ? rupees(e.debit) : "—"}</td>
                      </tr>
                    ))}
                    {shownLedger.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-muted">No transactions{hasFilter ? " match these filters" : " yet"}.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted">{shownLedger.length} of {ledger.entries.length} transactions shown</p>
          </section>
      ) : null}

    </div>
  );
}
