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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { useAuth } from "@/lib/auth";
import { formatDate, qty as fmtQty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, SearchBar, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";
import { CustomerReceiveModal } from "@/components/customer-receive-modal";

interface SaleItem {
  name: string;
  variant: string | null;
  qty: string;
}

interface SaleRow {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_mobile: string | null;
  sale_date: string;
  type: "retail" | "wholesale";
  items: SaleItem[];
}

export default function SalesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [receiving, setReceiving] = useState<SaleRow | null>(null);

  const filters = useMemo(() => ({ search, type: typeFilter }), [search, typeFilter]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<SaleRow>("/sales", filters);

  async function remove(s: SaleRow) {
    const who = s.customer_name || s.customer_mobile || "Walk-in";
    if (!confirm(`Delete this sale to "${who}"? This reverses the stock it removed.`)) return;
    try {
      await api(`/sales/${s.id}`, { method: "DELETE" });
      toast("Sale deleted", "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function itemsLabel(items: SaleItem[]): string {
    if (!items || items.length === 0) return "—";
    const parts = items.slice(0, 2).map((it) => `${it.name}${it.variant ? ` (${it.variant})` : ""} · ${fmtQty(it.qty)}`);
    return parts.join(", ");
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Sales"
        subtitle="Retail & wholesale — finished goods go out of stock."
        count={total}
        actions={
          <Link
            href="/sales/new"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm hover:bg-primary-hover"
          >
            <Icon.Plus /> <span className="hidden sm:inline">New Sale</span>
          </Link>
        }
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by customer / mobile…">
        <div className="w-full shrink-0 sm:w-44">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            <option value="retail">Retail</option>
            <option value="wholesale">Wholesale</option>
          </Select>
        </div>
      </SearchBar>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No sales yet" hint="Use 'New Sale' above to bill a customer." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="cursor-pointer" onClick={() => router.push(`/sales/new?edit=${s.id}`)}>
                      <td className="text-muted">{formatDate(s.sale_date)}</td>
                      <td className="font-medium text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          {s.customer_name || s.customer_mobile || "Walk-in"}
                          <Badge tone={s.type === "wholesale" ? "accent" : "neutral"}>{s.type}</Badge>
                        </span>
                      </td>
                      <td className="max-w-[26rem] truncate text-muted">
                        {itemsLabel(s.items)}
                        {s.items && s.items.length > 2 && (
                          <span className="text-muted/70"> +{s.items.length - 2} more</span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {s.customer_id != null && (
                            <button onClick={(e) => { e.stopPropagation(); setReceiving(s); }} className="inline-flex cursor-pointer items-center rounded-md bg-primary-tint px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-fg">Receive</button>
                          )}
                          <button onClick={() => router.push(`/sales/new?edit=${s.id}`)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                          {user?.role === "owner" && (
                            <button onClick={() => remove(s)} className="inline-flex cursor-pointer items-center rounded-md bg-[color:var(--danger-tint)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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

      {receiving && receiving.customer_id != null && (
        <CustomerReceiveModal
          customerId={receiving.customer_id}
          customerName={receiving.customer_name || receiving.customer_mobile || "Customer"}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); reload(); }}
        />
      )}
    </div>
  );
}
