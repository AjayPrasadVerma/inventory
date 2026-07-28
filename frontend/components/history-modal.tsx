"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, qty as fmtQty, rupees } from "@/lib/utils";
import { Modal } from "./ui/modal";
import { Spinner } from "./ui/misc";

type ColType = "text" | "money" | "qty" | "date";
type Col = { label: string; type?: ColType };
interface HistoryData {
  name: string;
  stats: { label: string; value: number | string; money?: boolean }[];
  tables: { title: string; columns: Col[]; rows: (string | number | null)[][] }[];
}

function fmtCell(v: string | number | null, type?: ColType): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "money": return rupees(Number(v));
    case "qty": return fmtQty(v);
    case "date": return formatDate(String(v));
    default: return String(v);
  }
}
const isRight = (t?: ColType) => t === "money" || t === "qty";

/** Generic history view — a stat row + one or more sticky-header, scrollable tables. */
export function HistoryModal({
  title,
  endpoint,
  onClose,
}: {
  title: string;
  endpoint: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ data: HistoryData }>(endpoint)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, [endpoint]);

  return (
    <Modal open onClose={onClose} size="xl" title={title}>
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
      {!data && !error ? (
        <div className="py-10 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.stats.map((s) => (
              <div key={s.label} className="soft-card p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{s.label}</p>
                <p className="text-lg font-semibold text-ink">
                  {s.money ? rupees(Number(s.value)) : s.value}
                </p>
              </div>
            ))}
          </div>

          {data.tables.map((t, ti) => (
            <div key={ti}>
              <p className="mb-1.5 text-sm font-semibold text-ink">{t.title}</p>
              <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-border">
                <table className="data-table sticky-head">
                  <thead>
                    <tr>
                      {t.columns.map((c, ci) => (
                        <th key={ci} className={isRight(c.type) ? "num" : ""}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.length === 0 ? (
                      <tr>
                        <td colSpan={t.columns.length} className="py-5 text-center text-muted">Nothing yet.</td>
                      </tr>
                    ) : (
                      t.rows.map((r, ri) => (
                        <tr key={ri}>
                          {r.map((cell, ci) => {
                            const col = t.columns[ci];
                            return (
                              <td
                                key={ci}
                                className={
                                  isRight(col?.type) ? "num" : ci === 0 ? "font-medium text-ink" : "text-muted"
                                }
                              >
                                {fmtCell(cell, col?.type)}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
