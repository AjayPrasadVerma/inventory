"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { formatDate, qty as fmtQty, rupees, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";

interface VendorLite { id: number; name: string; phone: string | null; city: string | null; balance: string }
interface LedgerItem { name: string; color: string | null; unit: string; qty: string }
interface LedgerData {
  entries: { date: string; type: "purchase" | "payment"; ref: string; credit: number; debit: number; items?: LedgerItem[] }[];
}

export default function VendorAccountPage() {
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters — default to the current month (1st → today)
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayISO());
  const [type, setType] = useState<"all" | "purchase" | "payment">("all");
  const [search, setSearch] = useState("");

  // Load the vendor list once and honour a ?v=<id> pre-selection (set inside the
  // resolved promise so no state is set synchronously during the effect).
  useEffect(() => {
    cachedGet<{ data: VendorLite[] }>("/vendors/options")
      .then((r) => {
        setVendors(r.data);
        const preset = new URLSearchParams(window.location.search).get("v");
        if (preset && r.data.some((v) => String(v.id) === preset)) setVendorId(preset);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadAccount = useCallback((id: string) => {
    let alive = true;
    setLoading(true);
    setError(null);
    api<{ data: LedgerData }>(`/vendors/${id}/ledger`)
      .then((l) => { if (alive) setLedger(l.data); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!vendorId) return; // render guards on !vendorId, so stale data is never shown
    // Keep the URL shareable/refresh-safe without a full navigation.
    window.history.replaceState(null, "", `?v=${vendorId}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads account data after a vendor change
    return loadAccount(vendorId);
  }, [vendorId, loadAccount]);

  const vendorOptions = useMemo<ComboOption[]>(
    () => vendors.map((v) => ({ value: String(v.id), label: v.name, sublabel: [v.city, v.phone].filter(Boolean).join(" · ") || undefined })),
    [vendors],
  );
  const hasFilter = !!(from || to || type !== "all" || search.trim());
  const s = search.trim().toLowerCase();
  const statsReady = !loading && !!ledger;

  // Running balance over ALL entries (so the true outstanding stays correct),
  // then filter which rows are shown by date / type / search.
  const shownLedger = useMemo(() => {
    if (!ledger) return [] as LedgerData["entries"];
    return ledger.entries.filter((e) =>
      (!from || e.date >= from) && (!to || e.date <= to) &&
      (type === "all" || e.type === type) &&
      (!s || e.ref.toLowerCase().includes(s)),
    );
  }, [ledger, from, to, type, s]);

  // KPIs + material breakdown — derived from the FILTERED rows so they match the
  // date range / type / search shown in the table (not all-time).
  const stats = useMemo(() => {
    if (!ledger) return null;
    let purchases = 0, paid = 0;
    const matMap = new Map<string, { name: string; color: string | null; unit: string; qty: number }>();
    for (const e of shownLedger) {
      if (e.type === "purchase") {
        purchases++;
        for (const it of e.items ?? []) {
          const key = `${it.name}|${it.color ?? ""}|${it.unit}`;
          const cur = matMap.get(key) ?? { name: it.name, color: it.color, unit: it.unit, qty: 0 };
          cur.qty += Number(it.qty) || 0;
          matMap.set(key, cur);
        }
      }
      paid += e.debit;
    }
    const materials = [...matMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { purchases, paid, materials };
  }, [ledger, shownLedger]);

  function clearFilters() { setFrom(""); setTo(""); setType("all"); setSearch(""); }

  return (
    <div className="w-full pb-16">
      <PageHeader backHref="/vendors" title="Vendor Account" subtitle="Ledger and purchase history in one place." />

      {/* Top: small uniform KPI tiles — purchases, paid, then one tile per material bought */}
      <div className="mb-4 grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
        <div className="rounded-[14px] border border-border bg-primary-tint px-3 py-2 shadow-[var(--shadow-xs)]">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-primary">Total Purchases</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{statsReady && stats ? stats.purchases : "—"}</p>
        </div>
        <div className="rounded-[14px] border border-border bg-[color:var(--success-tint)] px-3 py-2 shadow-[var(--shadow-xs)]">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[color:var(--success)]">Paid</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[color:var(--success)]">{statsReady && stats ? rupees(stats.paid) : "—"}</p>
        </div>
        {statsReady && stats && stats.materials.map((m, i) => {
          const tint = ["bg-[color:var(--accent-tint)]", "bg-primary-tint", "bg-[color:var(--success-tint)]", "bg-[color:var(--warning-tint)]"][i % 4];
          return (
            <div key={i} className={`rounded-[14px] border border-border px-3 py-2 shadow-[var(--shadow-xs)] ${tint}`}>
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted" title={`${m.name}${m.color ? ` (${m.color})` : ""}`}>
                {m.name}{m.color ? ` (${m.color})` : ""}
              </p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">
                {fmtQty(m.qty)} <span className="text-[11px] font-normal text-muted">{m.unit}</span>
              </p>
            </div>
          );
        })}
      </div>

      {/* Toolbar: vendor picker + filters in one row */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <Label>Vendor</Label>
            <Combobox options={vendorOptions} value={vendorId} onChange={setVendorId} placeholder="Search vendor…" ariaLabel="Vendor" />
          </div>
          <div className="w-36">
            <Label>From</Label>
            <DateField value={from} onChange={setFrom} disabled={!vendorId} ariaLabel="From date" />
          </div>
          <div className="w-36">
            <Label>To</Label>
            <DateField value={to} onChange={setTo} min={from || undefined} disabled={!vendorId} ariaLabel="To date" />
          </div>
          <div className="w-36">
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={!vendorId}>
              <option value="all">All entries</option>
              <option value="purchase">Purchases</option>
              <option value="payment">Payments</option>
            </Select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label>Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill no. / reference…" disabled={!vendorId} />
          </div>
          {hasFilter && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>
      </Card>

      {error && <p className="mt-4 text-sm text-[color:var(--danger)]">{error}</p>}

      {!vendorId ? (
        <Card className="mt-4"><EmptyState title="Select a vendor" hint="Pick a vendor above to see its ledger and purchase history." /></Card>
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
                      <th>Date</th><th>Type</th><th>Details</th><th>Items purchased</th>
                      <th className="num">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownLedger.map((e, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap text-muted">{formatDate(e.date)}</td>
                        <td>
                          <Badge tone={e.type === "purchase" ? "accent" : "success"}>
                            {e.type === "purchase" ? "Purchase" : "Payment"}
                          </Badge>
                        </td>
                        <td className="text-ink">{e.ref}</td>
                        <td className="text-muted">
                          {e.items && e.items.length > 0
                            ? e.items.map((it) => `${it.name}${it.color ? ` (${it.color})` : ""} · ${fmtQty(it.qty)} ${it.unit}`).join(",  ")
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
