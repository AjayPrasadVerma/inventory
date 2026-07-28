"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, rupees } from "@/lib/utils";
import { Modal } from "./ui/modal";
import { Input } from "./ui/field";
import { Spinner } from "./ui/misc";

interface LedgerData {
  entries: { date: string; type: string; ref: string; credit: number; debit: number }[];
}

/**
 * Reusable ledger statement — scrolls internally (handles months/years of rows),
 * sticky column header, date-range filter, running balance and total.
 */
export function LedgerModal({
  title,
  endpoint,
  creditLabel,
  debitLabel,
  onClose,
}: {
  title: string;
  endpoint: string;
  creditLabel: string;
  debitLabel: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<LedgerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset then fetch when the endpoint changes
  useEffect(() => {
    setData(null);
    setError(null);
    api<{ data: LedgerData }>(endpoint)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, [endpoint]);

  const { shown, totalDue } = useMemo(() => {
    if (!data) return { shown: [] as (LedgerData["entries"][number] & { running: number })[], totalDue: 0 };
    let run = 0;
    const withRun = data.entries.map((e) => {
      run += e.credit - e.debit;
      return { ...e, running: run };
    });
    const filtered = withRun.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
    return { shown: filtered, totalDue: run };
  }, [data, from, to]);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={title}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-sm text-muted">{data ? `${data.entries.length} entries` : ""}</span>
          <span className="text-sm">
            <span className="text-muted">Total due: </span>
            <span className="font-semibold text-ink">{rupees(totalDue)}</span>
          </span>
        </div>
      }
    >
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
      {!data && !error ? (
        <div className="py-10 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : data ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="mb-1 block text-xs text-muted">From</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
            </div>
            <div>
              <span className="mb-1 block text-xs text-muted">To</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
            </div>
            {(from || to) && (
              <button onClick={() => { setFrom(""); setTo(""); }} className="h-9 text-sm font-medium text-primary">
                Clear
              </button>
            )}
          </div>

          <div className="max-h-[56vh] overflow-y-auto rounded-lg border border-border">
            <table className="data-table sticky-head">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Detail</th>
                  <th className="num">{creditLabel}</th>
                  <th className="num">{debitLabel}</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={i}>
                    <td className="text-muted">{formatDate(e.date)}</td>
                    <td className="text-ink">{e.ref}</td>
                    <td className="num">{e.credit ? rupees(e.credit) : "—"}</td>
                    <td className="num">{e.debit ? rupees(e.debit) : "—"}</td>
                    <td className="num font-medium">{rupees(e.running)}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted">No entries in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
