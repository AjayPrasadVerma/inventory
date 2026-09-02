"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { formatDate, qty as fmtQty } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";

interface ItemLite { id: number; name: string }
type Reason = "purchase" | "adjustment" | "karigar_out" | "karigar_in" | "job_issue" | "job_return";
interface StockEntry { date: string; reason: Reason; party: string | null; variant: string | null; unit: string; qty: number; note: string | null }
interface StockData {
  onHand: { variant: string | null; unit: string; qty: number }[];
  entries: StockEntry[];
}

export default function MaterialStockPage() {
  const [items, setItems] = useState<ItemLite[]>([]);
  const router = useRouter();
  const params = useSearchParams();
  // The record on screen comes from the URL, not from local state: the command
  // palette navigates by changing only ?i=, which does not remount this segment,
  // so anything read once on mount would ignore it.
  const itemId = params.get("i") ?? "";
  const setItemId = useCallback(
    (id: string) => router.replace(id ? `?i=${id}` : "?", { scroll: false }),
    [router],
  );
  const [stock, setStock] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opens on everything. A history page that defaults to this month greets the
  // owner with "no movements match" for anything bought before the 1st.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"all" | "purchase" | "karigar_out" | "karigar_in" | "adjustment">("all");
  const [search, setSearch] = useState("");

  // Load the material list once and honour a ?i=<id> pre-selection (set inside the
  // resolved promise so no state is set synchronously during the effect).
  useEffect(() => {
    cachedGet<{ data: ItemLite[] }>("/items/options")
      .then((r) => {
        setItems(r.data);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadStock = useCallback((id: string) => {
    let alive = true;
    setLoading(true);
    setError(null);
    api<{ data: StockData }>(`/items/${id}/stock`)
      .then((s) => { if (alive) setStock(s.data); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!itemId) return; // render guards on !itemId, so stale data is never shown
    // Keep the URL shareable/refresh-safe without a full navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads stock data after a material change
    return loadStock(itemId);
  }, [itemId, loadStock]);

  const itemOptions = useMemo<ComboOption[]>(
    () => items.map((it) => ({ value: String(it.id), label: it.name })),
    [items],
  );
  const hasFilter = !!(from || to || type !== "all" || search.trim());
  const s = search.trim().toLowerCase();

  // Filter the movement rows by date / type / search (party or reason).
  const shown = useMemo(() => {
    if (!stock) return [] as StockEntry[];
    return stock.entries.filter((e) =>
      (!from || e.date >= from) && (!to || e.date <= to) &&
      (type === "all" || e.reason === type) &&
      (!s || (e.party ?? "").toLowerCase().includes(s) || e.reason.toLowerCase().includes(s)),
    );
  }, [stock, from, to, type, s]);

  function clearFilters() { setFrom(""); setTo(""); setType("all"); setSearch(""); }

  const reasonBadge: Record<Reason, { label: string; tone: "success" | "warning" | "accent" | "neutral" }> = {
    karigar_out: { label: "Issued", tone: "warning" },
    karigar_in: { label: "Returned", tone: "success" },
    purchase: { label: "Purchase", tone: "success" },
    job_issue: { label: "Issued", tone: "warning" },
    job_return: { label: "Returned", tone: "accent" },
    adjustment: { label: "Adjustment", tone: "neutral" },
  };

  return (
    <div className="w-full pb-16">
      <PageHeader backHref="/items" title="Material Stock" subtitle="On-hand, purchases and issues in one place." />

      {/* Toolbar: material picker + filters in one row */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <Label>Material</Label>
            <Combobox options={itemOptions} value={itemId} onChange={setItemId} placeholder="Search material…" ariaLabel="Material" />
          </div>
          <div className="w-full sm:w-[19rem]">
            <Label>Date range</Label>
            <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} disabled={!itemId} />
          </div>
          <div className="w-44">
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={!itemId}>
              <option value="all">All movements</option>
              <option value="purchase">Purchased in</option>
              <option value="karigar_out">Issued to karigar</option>
              <option value="karigar_in">Returned by karigar</option>
              <option value="adjustment">Opening / corrections</option>
            </Select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label>Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor / karigar / note…" disabled={!itemId} />
          </div>
          {hasFilter && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>
      </Card>

      {error && <p className="mt-4 text-sm text-[color:var(--danger)]">{error}</p>}

      {!itemId ? (
        <Card className="mt-4"><EmptyState title="Select a material" hint="Pick a material above to see its stock, purchases and issues." /></Card>
      ) : loading ? (
        <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : stock ? (
        <section className="mt-4">
          <Card className="mb-3 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">On hand</p>
            {stock.onHand.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {stock.onHand.map((o, i) => (
                  <span
                    key={i}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums ${
                      o.qty > 0
                        ? "bg-[color:var(--success-tint)] text-[color:var(--success)]"
                        : "bg-[color:var(--danger-tint)] text-[color:var(--danger)]"
                    }`}
                  >
                    {fmtQty(o.qty)} {o.unit}
                    {o.variant && <span className="ml-1.5 font-normal opacity-75">{o.variant}</span>}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Nothing on hand.</p>
            )}
          </Card>

          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">Movements</h2>
            <span className="text-xs text-muted tabular-nums">
              {shown.length < stock.entries.length ? `${shown.length} of ${stock.entries.length}` : shown.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-[62vh] overflow-auto">
              <table className="data-table stacked sticky-head sm:min-w-[820px]">
                <thead>
                  <tr>
                    <th>Date</th><th>Type</th><th>From / To</th><th>Size</th><th>Design</th>
                    <th className="num">In</th><th className="num">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e, i) => {
                    const b = reasonBadge[e.reason] ?? { label: e.reason, tone: "neutral" as const };
                    const label = e.reason === "adjustment" && e.note === "Opening stock" ? "Opening stock" : b.label;
                    return (
                      <tr key={i}>
                        <td data-label="Date" className="whitespace-nowrap text-muted">{formatDate(e.date)}</td>
                        <td data-label="Type"><Badge tone={b.tone}>{label}</Badge></td>
                        <td data-label="From / To" className="text-ink">{e.party || "—"}</td>
                        <td data-label="Size" className="text-muted">{e.unit}</td>
                        <td data-label="Design" className="text-muted">{e.variant || "—"}</td>
                        <td data-label="In" className="num">{e.qty > 0 ? fmtQty(e.qty) : "—"}</td>
                        <td data-label="Out" className="num">{e.qty < 0 ? fmtQty(-e.qty) : "—"}</td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-muted">No movements{hasFilter ? " match these filters" : " yet"}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
