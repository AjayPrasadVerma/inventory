"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { qty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/page-parts";
import { ReportTable, type ReportCol } from "@/components/report-table";

interface Row { vendor_name: string; item_name: string; color: string | null; unit: string; received_qty: string }

const columns: ReportCol<Row>[] = [
  { key: "vendor_name", label: "Vendor", render: (r) => <span className="font-medium text-ink">{r.vendor_name}</span> },
  { key: "item_name", label: "Material", render: (r) => <span className="text-ink">{r.item_name}</span> },
  { key: "color", label: "Colour", render: (r) => r.color || "—" },
  { key: "unit", label: "Unit" },
  { key: "received_qty", label: "Received", num: true, sortValue: (r) => Number(r.received_qty), render: (r) => qty(r.received_qty) },
];

export default function RawByVendorReport() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api<{ data: Row[] }>("/reports/raw-by-vendor")
      .then((r) => { if (alive) setRows(r.data); })
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set after await
  useEffect(() => load(), [load]);

  const [vendor, setVendor] = useState("");
  const vendorOptions = useMemo(
    () => [...new Set(rows.map((r) => r.vendor_name))].sort().map((v) => ({ value: v, label: v })),
    [rows],
  );
  const shown = useMemo(() => (vendor ? rows.filter((r) => r.vendor_name === vendor) : rows), [rows, vendor]);

  return (
    <div className="w-full">
      <PageHeader title="Raw Material by Vendor" subtitle="Which raw material came from which vendor, and how much." />
      <ReportTable columns={columns} rows={shown} loading={loading}
        exportName="raw-material-by-vendor" initialSortKey="vendor_name" searchPlaceholder="Search vendor / material…"
        toolbar={
          <div className="w-56">
            <Combobox options={vendorOptions} value={vendor} onChange={setVendor} placeholder="All vendors" ariaLabel="Filter by vendor" />
          </div>
        } />
    </div>
  );
}
