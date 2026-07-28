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
import { PageHeader, StatCard, StatStrip } from "@/components/page-parts";
import { Icon } from "@/components/icons";

interface KarigarLite { id: number; name: string; phone: string | null; total_paid: string }
interface LedgerItem { name: string; variant: string | null; qty: string }
interface LedgerData {
  totalPaid: number;
  entries: { date: string; type: "job" | "payment"; ref: string; paid: number; items?: LedgerItem[] }[];
}

export default function KarigarAccountPage() {
  const [karigars, setKarigars] = useState<KarigarLite[]>([]);
  const [karigarId, setKarigarId] = useState("");
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters — default to the current month (1st → today)
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayISO());
  const [type, setType] = useState<"all" | "job" | "payment">("all");
  const [search, setSearch] = useState("");

  // Load the karigar list once and honour a ?k=<id> pre-selection (set inside the
  // resolved promise so no state is set synchronously during the effect).
  useEffect(() => {
    cachedGet<{ data: KarigarLite[] }>("/karigars/options")
      .then((r) => {
        setKarigars(r.data);
        const preset = new URLSearchParams(window.location.search).get("k");
        if (preset && r.data.some((k) => String(k.id) === preset)) setKarigarId(preset);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadAccount = useCallback((id: string) => {
    let alive = true;
    setLoading(true);
    setError(null);
    api<{ data: LedgerData }>(`/karigars/${id}/ledger`)
      .then((l) => { if (alive) setLedger(l.data); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!karigarId) return; // render guards on !karigarId, so stale data is never shown
    // Keep the URL shareable/refresh-safe without a full navigation.
    window.history.replaceState(null, "", `?k=${karigarId}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads account data after a karigar change
    return loadAccount(karigarId);
  }, [karigarId, loadAccount]);

  const karigarOptions = useMemo<ComboOption[]>(
    () => karigars.map((k) => ({ value: String(k.id), label: k.name, sublabel: k.phone || undefined })),
    [karigars],
  );
  const hasFilter = !!(from || to || type !== "all" || search.trim());
  const s = search.trim().toLowerCase();
  const statsReady = !loading && !!ledger;

  // KPIs derived straight from the ledger — no running balance anymore, just
  // counts of jobs / payments and the total money paid to this karigar.
  const stats = useMemo(() => {
    if (!ledger) return null;
    let jobs = 0, payments = 0;
    for (const e of ledger.entries) {
      if (e.type === "job") jobs++;
      else payments++;
    }
    return { jobs, payments };
  }, [ledger]);

  const shownLedger = useMemo(() => {
    if (!ledger) return [];
    return ledger.entries.filter((e) =>
      (!from || e.date >= from) && (!to || e.date <= to) &&
      (type === "all" || e.type === type) &&
      (!s || e.ref.toLowerCase().includes(s)),
    );
  }, [ledger, from, to, type, s]);

  function clearFilters() { setFrom(""); setTo(""); setType("all"); setSearch(""); }

  return (
    <div className="w-full pb-16">
      <PageHeader backHref="/karigars" title="Karigar Account" subtitle="Ledger and work history in one place." />

      {/* KPIs on top — fill in once a karigar is selected */}
      <StatStrip>
        <StatCard label="Total Jobs" value={statsReady && stats ? String(stats.jobs) : "—"} icon={<Icon.Job />} />
        <StatCard label="Payments" value={statsReady && stats ? String(stats.payments) : "—"} icon={<Icon.Job />} />
        <StatCard label="Total Paid" value={statsReady && ledger ? rupees(ledger.totalPaid) : "—"} icon={<Icon.Ledger />} />
      </StatStrip>

      {/* Toolbar: karigar picker + filters in one row */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <Label>Karigar</Label>
            <Combobox options={karigarOptions} value={karigarId} onChange={setKarigarId} placeholder="Search karigar…" ariaLabel="Karigar" />
          </div>
          <div className="w-36">
            <Label>From</Label>
            <DateField value={from} onChange={setFrom} disabled={!karigarId} ariaLabel="From date" />
          </div>
          <div className="w-36">
            <Label>To</Label>
            <DateField value={to} onChange={setTo} min={from || undefined} disabled={!karigarId} ariaLabel="To date" />
          </div>
          <div className="w-36">
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={!karigarId}>
              <option value="all">All entries</option>
              <option value="job">Jobs</option>
              <option value="payment">Payments</option>
            </Select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label>Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill no. / reference…" disabled={!karigarId} />
          </div>
          {hasFilter && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>
      </Card>

      {error && <p className="mt-4 text-sm text-[color:var(--danger)]">{error}</p>}

      {!karigarId ? (
        <Card className="mt-4"><EmptyState title="Select a karigar" hint="Pick a karigar above to see its ledger and work history." /></Card>
      ) : loading ? (
        <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : ledger ? (
        <section className="mt-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink">Ledger &amp; history</h2>
              <span className="text-sm">
                <span className="text-muted">Total paid: </span>
                <span className="font-semibold text-ink tabular-nums">{rupees(ledger.totalPaid)}</span>
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="max-h-[62vh] overflow-auto">
                <table className="data-table sticky-head min-w-[880px]">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Details</th><th>Goods made</th>
                      <th className="num">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownLedger.map((e, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap text-muted">{formatDate(e.date)}</td>
                        <td>
                          <Badge tone={e.type === "job" ? "accent" : "success"}>
                            {e.type === "job" ? "Job" : "Payment"}
                          </Badge>
                        </td>
                        <td className="text-ink">{e.ref}</td>
                        <td className="text-muted">
                          {e.type === "job" && e.items && e.items.length
                            ? e.items.map((it) => `${it.name}${it.variant ? ` (${it.variant})` : ""} · ${fmtQty(it.qty)}`).join(", ")
                            : "—"}
                        </td>
                        <td className="num">{e.type === "payment" ? rupees(e.paid) : "—"}</td>
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
