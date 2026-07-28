"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { qty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/misc";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/page-parts";
import { ReportTable, type ReportCol } from "@/components/report-table";

interface Row { item_name: string; category: string | null; color: string | null; unit: string; on_hand: string; is_low: boolean }

const columns: ReportCol<Row>[] = [
  { key: "item_name", label: "Material", render: (r) => <span className="font-medium text-ink">{r.item_name}</span> },
  { key: "category", label: "Category", render: (r) => r.category || "—" },
  { key: "color", label: "Colour", render: (r) => r.color || "—" },
  { key: "unit", label: "Unit" },
  { key: "on_hand", label: "On hand", num: true, sortValue: (r) => Number(r.on_hand), render: (r) => qty(r.on_hand) },
  {
    key: "status", label: "Status", sortValue: (r) => (Number(r.on_hand) < 0 ? 0 : r.is_low ? 1 : 2),
    render: (r) => Number(r.on_hand) < 0
      ? <Badge tone="danger">Oversold</Badge>
      : r.is_low ? <Badge tone="warning">Low</Badge> : <Badge tone="success">OK</Badge>,
    searchText: (r) => (Number(r.on_hand) < 0 ? "oversold" : r.is_low ? "low" : "ok"),
  },
];

export default function RawStockReport() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api<{ data: Row[] }>("/reports/raw-stock")
      .then((r) => { if (alive) setRows(r.data); })
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set after await
  useEffect(() => load(), [load]);

  const [material, setMaterial] = useState("");
  const materialOptions = useMemo(
    () => [...new Set(rows.map((r) => r.item_name))].sort().map((v) => ({ value: v, label: v })),
    [rows],
  );
  const shown = useMemo(() => (material ? rows.filter((r) => r.item_name === material) : rows), [rows, material]);

  return (
    <div className="w-full">
      <PageHeader title="Raw Material Stock" subtitle="On-hand quantity of every raw material, with low-stock alerts." />
      <ReportTable columns={columns} rows={shown} loading={loading}
        exportName="raw-material-stock" initialSortKey="item_name" searchPlaceholder="Search material / colour / status…"
        toolbar={
          <div className="w-56">
            <Combobox options={materialOptions} value={material} onChange={setMaterial} placeholder="All materials" ariaLabel="Filter by material" />
          </div>
        } />
    </div>
  );
}
