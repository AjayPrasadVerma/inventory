"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { qty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/misc";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/page-parts";
import { ReportTable, type ReportCol } from "@/components/report-table";

interface Row { product_name: string; category: string | null; variant: string | null; on_hand: string; is_low: boolean }

const columns: ReportCol<Row>[] = [
  { key: "product_name", label: "Product", render: (r) => <span className="font-medium text-ink">{r.product_name}</span> },
  { key: "category", label: "Category", render: (r) => r.category || "—" },
  { key: "variant", label: "Variant", render: (r) => r.variant || "—" },
  { key: "on_hand", label: "On hand", num: true, sortValue: (r) => Number(r.on_hand), render: (r) => qty(r.on_hand) },
  {
    key: "status", label: "Status", sortValue: (r) => (Number(r.on_hand) < 0 ? 0 : r.is_low ? 1 : 2),
    render: (r) => Number(r.on_hand) < 0
      ? <Badge tone="danger">Oversold</Badge>
      : r.is_low ? <Badge tone="warning">Low</Badge> : <Badge tone="success">OK</Badge>,
    searchText: (r) => (Number(r.on_hand) < 0 ? "oversold" : r.is_low ? "low" : "ok"),
  },
];

export default function FinishedStockReport() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api<{ data: Row[] }>("/reports/finished-stock")
      .then((r) => { if (alive) setRows(r.data); })
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set after await
  useEffect(() => load(), [load]);

  const [product, setProduct] = useState("");
  const productOptions = useMemo(
    () => [...new Set(rows.map((r) => r.product_name))].sort().map((v) => ({ value: v, label: v })),
    [rows],
  );
  const shown = useMemo(() => (product ? rows.filter((r) => r.product_name === product) : rows), [rows, product]);

  return (
    <div className="w-full">
      <PageHeader title="Finished Goods Stock" subtitle="On-hand quantity of every finished product, product-wise." />
      <ReportTable columns={columns} rows={shown} loading={loading}
        exportName="finished-goods-stock" initialSortKey="product_name" searchPlaceholder="Search product / variant / status…"
        toolbar={
          <div className="w-56">
            <Combobox options={productOptions} value={product} onChange={setProduct} placeholder="All products" ariaLabel="Filter by product" />
          </div>
        } />
    </div>
  );
}
