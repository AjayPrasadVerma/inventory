"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { useAuth } from "@/lib/auth";
import { formatDate, qty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, SearchBar, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";

interface JobRow {
  id: number;
  karigar_id: number;
  karigar_name: string;
  job_date: string;
  expected_note: string | null;
  status: "open" | "closed";
  issue_lines: number;
  received_qty: string;
}

export default function JobsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const filters = useMemo(() => ({ search, status }), [search, status]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<JobRow>("/jobs", filters);

  async function remove(e: React.MouseEvent, j: JobRow) {
    e.stopPropagation();
    if (!confirm(`Delete Job #${j.id} (${j.karigar_name})? This reverses the issued material and any received goods from stock.`)) return;
    try {
      await api(`/jobs/${j.id}`, { method: "DELETE" });
      toast("Job deleted", "success");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function toggleStatus(e: React.MouseEvent, j: JobRow) {
    e.stopPropagation();
    const next = j.status === "open" ? "closed" : "open";
    try {
      await api(`/jobs/${j.id}`, { method: "PATCH", body: { status: next } });
      toast(next === "closed" ? "Job marked complete" : "Job reopened", "success");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Karigar Jobs"
        subtitle="Material issue → goods receipt → finished stock."
        count={total}
        actions={
          <Link
            href="/jobs/new"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm hover:bg-primary-hover"
          >
            <Icon.Plus /> <span className="hidden sm:inline">New Job</span>
          </Link>
        }
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by karigar or work…">
        <div className="w-full shrink-0 sm:w-44">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Select>
        </div>
      </SearchBar>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No jobs found" hint="Use 'New Job' above to issue material to a karigar." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Karigar</th>
                  <th>Work</th>
                  <th>Material / Goods</th>
                  <th className="text-center">Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} className="clickable" onClick={() => router.push(`/jobs/detail?j=${j.id}`)}>
                    <td className="text-muted">{formatDate(j.job_date)}</td>
                    <td className="font-medium text-ink">{j.karigar_name}</td>
                    <td className="text-muted">{j.expected_note || "—"}</td>
                    <td className="text-muted">
                      {j.issue_lines} issued · {qty(j.received_qty)} received
                    </td>
                    <td className="text-center">
                      <Badge tone={j.status === "open" ? "warning" : "success"}>
                        {j.status === "open" ? "Open" : "Closed"}
                      </Badge>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={(e) => toggleStatus(e, j)}
                          className={
                            "inline-flex cursor-pointer items-center rounded-md px-2.5 text-xs font-medium transition-colors " +
                            (j.status === "open"
                              ? "bg-[color:var(--success-tint)] text-[color:var(--success)] hover:bg-[color:var(--success)] hover:text-white"
                              : "bg-surface-2 text-ink hover:bg-border-strong")
                          }
                        >
                          {j.status === "open" ? "Mark complete" : "Reopen"}
                        </button>
                        <button onClick={() => router.push(`/jobs/detail?j=${j.id}&edit=1`)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                        {user?.role === "owner" && (
                          <button onClick={(e) => remove(e, j)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-muted transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        )}
      </Card>
    </div>
  );
}
