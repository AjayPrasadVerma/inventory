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
import { api } from "@/lib/api";
import { qty as fmtQty, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Label } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/page-parts";
import { ReportTable, type ReportCol } from "@/components/report-table";

interface ProductRow { product_name: string; variant: string | null; qty: string }

const columns: ReportCol<ProductRow>[] = [
  { key: "product_name", label: "Product", render: (r) => <span className="font-medium text-ink">{r.product_name}</span> },
  { key: "variant", label: "Variant", render: (r) => r.variant || "—" },
  { key: "qty", label: "Qty sold", num: true, sortValue: (r) => Number(r.qty), render: (r) => fmtQty(r.qty) },
];

export default function SalesReport() {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayISO());
  const [product, setProduct] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((f: string, t: string) => {
    let alive = true;
    setLoading(true);
    api<{ data: { products: ProductRow[] } }>("/reports/sales-report", { params: { from: f, to: t } })
      .then((r) => { if (alive) setRows(r.data.products); })
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on date-range change; state set after await
  useEffect(() => load(from, to), [from, to, load]);

  const productOptions = useMemo(
    () => [...new Set(rows.map((r) => r.product_name))].sort().map((v) => ({ value: v, label: v })),
    [rows],
  );
  const shown = useMemo(() => (product ? rows.filter((r) => r.product_name === product) : rows), [rows, product]);

  return (
    <div className="w-full">
      <PageHeader title="Sales Report" subtitle="Product-wise quantity sold for a date range." />

      <ReportTable
        columns={columns}
        rows={shown}
        loading={loading}
        exportName="sales-report"
        initialSortKey="qty"
        initialSortDir="desc"
        searchPlaceholder="Search product / variant…"
        emptyTitle="No sales in this range"
        emptyHint="Pick a different date range, or record a sale."
        toolbar={
          <>
            <div className="w-48">
              <Label>Product</Label>
              <Combobox options={productOptions} value={product} onChange={setProduct} placeholder="All products" ariaLabel="Filter by product" />
            </div>
            <div className="w-36">
              <Label>From</Label>
              <DateField value={from} onChange={setFrom} max={to || todayISO()} ariaLabel="From date" />
            </div>
            <div className="w-36">
              <Label>To</Label>
              <DateField value={to} onChange={setTo} min={from || undefined} ariaLabel="To date" />
            </div>
          </>
        }
      />
    </div>
  );
}
