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
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useServerList } from "@/lib/use-server-list";
import { rupees } from "@/lib/utils";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, SearchBar, Pagination } from "@/components/page-parts";

interface Customer {
  id: number;
  mobile: string | null;
  name: string | null;
  type: "retail" | "wholesale";
  credit_allowed: boolean;
  balance: string;
  sales_count: number;
}

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filters = useMemo(() => ({ search }), [search]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize } = useServerList<Customer>("/customers", filters);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customers"
        subtitle="Auto-created at sale time, found by mobile number."
        count={total}
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name / mobile…" />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No customers yet" hint="Customers appear here automatically after their first sale." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Type</th>
                  <th className="num">Sales</th>
                  <th className="num">Balance</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const bal = Number(c.balance);
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-ink">{c.name || "—"}</td>
                      <td className="text-muted">{c.mobile || "—"}</td>
                      <td><Badge tone={c.type === "wholesale" ? "accent" : "neutral"}>{c.type}</Badge></td>
                      <td className="num text-muted">{c.sales_count}</td>
                      <td className="num">
                        <Badge tone={bal > 0 ? "danger" : "success"}>{rupees(bal)} {bal > 0 ? "due" : ""}</Badge>
                      </td>
                      <td>
                        <div className="flex justify-end">
                          <button
                            onClick={() => router.push(`/customers/account?c=${c.id}`)}
                            className="inline-flex cursor-pointer items-center rounded-md bg-primary-tint px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-fg"
                          >
                            Account
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
