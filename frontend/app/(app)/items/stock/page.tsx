"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { formatDate, qty as fmtQty, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";

interface ItemLite { id: number; name: string }
type Reason = "purchase" | "adjustment" | "job_issue" | "job_return";
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

  // filters — default to the current month (1st → today)
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayISO());
  const [type, setType] = useState<"all" | "purchase" | "job_issue" | "job_return" | "adjustment">("all");
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
          <div className="w-36">
            <Label>From</Label>
            <DateField value={from} onChange={setFrom} disabled={!itemId} ariaLabel="From date" />
          </div>
          <div className="w-36">
            <Label>To</Label>
            <DateField value={to} onChange={setTo} min={from || undefined} disabled={!itemId} ariaLabel="To date" />
          </div>
          <div className="w-44">
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={!itemId}>
              <option value="all">All movements</option>
              <option value="purchase">Purchases (in)</option>
              <option value="job_issue">Issued to karigar</option>
              <option value="job_return">Returns</option>
              <option value="adjustment">Opening / adjustments</option>
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
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
            <h2 className="text-sm font-semibold text-ink">Stock movements</h2>
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted">On hand:</span>
              {stock.onHand.length > 0
                ? stock.onHand.map((o, i) => (
                    <Badge key={i} tone={o.qty > 0 ? "success" : "neutral"}>{`${o.variant ? o.variant + " · " : ""}${fmtQty(o.qty)} ${o.unit}`}</Badge>
                  ))
                : <span className="text-muted">nothing on hand</span>}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-[62vh] overflow-auto">
              <table className="data-table sticky-head min-w-[820px]">
                <thead>
                  <tr>
                    <th>Date</th><th>Type</th><th>From / To</th><th>Colour</th><th>Unit</th>
                    <th className="num">In</th><th className="num">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e, i) => {
                    const b = reasonBadge[e.reason];
                    const label = e.reason === "adjustment" && e.note === "Opening stock" ? "Opening stock" : b.label;
                    return (
                      <tr key={i}>
                        <td className="whitespace-nowrap text-muted">{formatDate(e.date)}</td>
                        <td><Badge tone={b.tone}>{label}</Badge></td>
                        <td className="text-ink">{e.party || "—"}</td>
                        <td className="text-muted">{e.variant || "—"}</td>
                        <td className="text-muted">{e.unit}</td>
                        <td className="num">{e.qty > 0 ? fmtQty(e.qty) : "—"}</td>
                        <td className="num">{e.qty < 0 ? fmtQty(-e.qty) : "—"}</td>
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
          <p className="mt-1.5 text-xs text-muted">{shown.length} of {stock.entries.length} movements shown</p>
        </section>
      ) : null}
    </div>
  );
}
