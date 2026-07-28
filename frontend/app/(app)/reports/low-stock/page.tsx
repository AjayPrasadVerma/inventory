"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { qty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import { ReportTable, type ReportCol } from "@/components/report-table";

interface Row { kind: "Raw" | "Finished"; name: string; category: string | null; variant: string | null; unit: string; on_hand: string; is_low: boolean }

const columns: ReportCol<Row>[] = [
  { key: "kind", label: "Type", render: (r) => <Badge tone={r.kind === "Raw" ? "neutral" : "accent"}>{r.kind}</Badge> },
  { key: "name", label: "Name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
  { key: "category", label: "Category", render: (r) => r.category || "—" },
  { key: "variant", label: "Colour / Variant", render: (r) => r.variant || "—" },
  { key: "unit", label: "Unit", render: (r) => r.unit || "—" },
  { key: "on_hand", label: "On hand", num: true, sortValue: (r) => Number(r.on_hand), render: (r) => qty(r.on_hand) },
  {
    key: "status", label: "Status", sortValue: (r) => (Number(r.on_hand) < 0 ? 0 : 1),
    render: (r) => Number(r.on_hand) < 0 ? <Badge tone="danger">Oversold</Badge> : <Badge tone="warning">Low</Badge>,
    searchText: (r) => (Number(r.on_hand) < 0 ? "oversold" : "low"),
  },
];

export default function LowStockReport() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    // One dedicated endpoint returns only the low/oversold lines (raw + finished),
    // instead of downloading both full stock reports and filtering in the browser.
    api<{ data: Row[] }>("/reports/low-stock")
      .then((r) => { if (alive) setRows(r.data.map((x) => ({ ...x, unit: x.unit ?? "" }))); })
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set after await
  useEffect(() => load(), [load]);

  return (
    <div className="w-full">
      <PageHeader title="Low / Oversold Stock" subtitle="Items at or below their low-stock alert, or gone negative — needs attention." />
      <ReportTable
        columns={columns}
        rows={rows}
        loading={loading}
        exportName="low-stock"
        initialSortKey="on_hand"
        initialSortDir="asc"
        searchPlaceholder="Search name / type / status…"
        emptyTitle="Nothing low or oversold"
        emptyHint="Set a low-stock alert on a material/product to track it here."
      />
    </div>
  );
}
