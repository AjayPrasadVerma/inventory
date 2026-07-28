"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, qty as fmtQty, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Label } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/page-parts";
import { ReportTable, type ReportCol } from "@/components/report-table";

interface Row { date: string; karigar_name: string; job_id: number; item_name: string; color: string | null; unit: string; qty: string }

const columns: ReportCol<Row>[] = [
  { key: "date", label: "Date", sortValue: (r) => r.date, csv: (r) => formatDate(r.date), render: (r) => <span className="whitespace-nowrap text-muted">{formatDate(r.date)}</span> },
  { key: "karigar_name", label: "Karigar", render: (r) => <span className="font-medium text-ink">{r.karigar_name}</span> },
  { key: "item_name", label: "Material", render: (r) => <span className="text-ink">{r.item_name}</span> },
  { key: "color", label: "Colour", render: (r) => r.color || "—" },
  { key: "unit", label: "Unit" },
  { key: "qty", label: "Qty", num: true, sortValue: (r) => Number(r.qty), render: (r) => fmtQty(r.qty) },
];

export default function KarigarIssuedReport() {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((f: string, t: string) => {
    let alive = true;
    setLoading(true);
    api<{ data: Row[] }>("/reports/karigar-issued", { params: { from: f, to: t } })
      .then((r) => { if (alive) setRows(r.data); })
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on date-range change; state set after await
  useEffect(() => load(from, to), [from, to, load]);

  const [karigar, setKarigar] = useState("");
  const karigarOptions = useMemo(
    () => [...new Set(rows.map((r) => r.karigar_name))].sort().map((v) => ({ value: v, label: v })),
    [rows],
  );
  const shown = useMemo(() => (karigar ? rows.filter((r) => r.karigar_name === karigar) : rows), [rows, karigar]);

  return (
    <div className="w-full">
      <PageHeader title="Material Issued to Karigars" subtitle="Which karigar got how much raw material, and when." />
      <ReportTable
        columns={columns}
        rows={shown}
        loading={loading}
        exportName="material-issued-to-karigars"
        initialSortKey="date"
        initialSortDir="desc"
        searchPlaceholder="Search karigar / material…"
        emptyTitle="No material issued in this range"
        emptyHint="Pick a different date range, or issue material via a Karigar Job."
        toolbar={
          <>
            <div className="w-48">
              <Label>Karigar</Label>
              <Combobox options={karigarOptions} value={karigar} onChange={setKarigar} placeholder="All karigars" ariaLabel="Filter by karigar" />
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
