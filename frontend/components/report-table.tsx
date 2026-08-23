"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, EmptyState, Spinner } from "./ui/misc";
import { SearchBar, Pagination } from "./page-parts";

export interface ReportCol<T> {
  key: string;
  label: string;
  num?: boolean; // right-aligned + numeric sort
  render?: (row: T) => React.ReactNode; // custom cell
  sortValue?: (row: T) => string | number; // value used for sorting (default: row[key])
  searchText?: (row: T) => string; // extra text folded into search (default: String(row[key]))
  csv?: (row: T) => string | number; // plain value for CSV export (default: searchText/raw)
}

/** Reusable report table: client search + click-to-sort headers + pagination + optional total row. */
export function ReportTable<T>({
  columns,
  rows,
  loading,
  searchPlaceholder = "Search…",
  initialSortKey,
  initialSortDir = "asc",
  emptyTitle = "No data yet",
  emptyHint = "This report fills in as you record purchases, jobs and sales.",
  toolbar,
  exportName,
}: {
  columns: ReportCol<T>[];
  rows: T[];
  loading: boolean;
  searchPlaceholder?: string;
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  emptyTitle?: string;
  emptyHint?: string;
  toolbar?: React.ReactNode; // extra controls (e.g. date range) shown in the search row
  exportName?: string; // base filename for CSV export (enables the Export button)
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(initialSortDir);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    const text = (c: ReportCol<T>, r: T) =>
      c.searchText ? c.searchText(r) : String((r as Record<string, unknown>)[c.key] ?? "");
    return rows.filter((r) => columns.some((c) => text(c, r).toLowerCase().includes(s)));
  }, [rows, q, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const val = (r: T) => (col.sortValue ? col.sortValue(r) : ((r as Record<string, unknown>)[sortKey] as string | number));
    const arr = [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return dir === "desc" ? arr.reverse() : arr;
  }, [filtered, sortKey, dir, columns]);

  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir("asc"); }
    setPage(1);
  }

  function exportCsv() {
    const cell = (c: ReportCol<T>, r: T) => {
      if (c.csv) return c.csv(r);
      if (c.searchText && !c.num) return c.searchText(r);
      const raw = (r as Record<string, unknown>)[c.key];
      // Numeric columns: strip trailing decimal zeros (e.g. "-66.000" -> -66, "3.500" -> 3.5)
      if (c.num) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : (raw ?? "");
      }
      return raw ?? "";
    };
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      columns.map((c) => esc(c.label)).join(","),
      ...sorted.map((r) => columns.map((c) => esc(cell(c, r))).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <SearchBar value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={searchPlaceholder}>
        {toolbar}
        {exportName && (
          <button
            onClick={exportCsv}
            disabled={sorted.length === 0}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-ink shadow-xs transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            Export
          </button>
        )}
      </SearchBar>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : sorted.length === 0 ? (
          <EmptyState title={q ? "No matches" : emptyTitle} hint={q ? "Try a different search." : emptyHint} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table stacked">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className={cn("cursor-pointer select-none whitespace-nowrap hover:text-ink", c.num && "num")}
                        title="Click to sort"
                      >
                        {c.label}
                        {sortKey === c.key && <span className="ml-1 text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.key} data-label={c.label} className={cn(c.num && "num", !c.render && !c.num && "text-muted")}>
                          {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={sorted.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        )}
      </Card>
    </>
  );
}
