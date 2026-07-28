"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { useAuth } from "@/lib/auth";
import { formatDate, qty as fmtQty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, SearchBar, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";
import { PayVendorModal } from "@/components/pay-vendor-modal";

interface PurchaseItem {
  name: string;
  color: string | null;
  unit: string;
  qty: string;
}

interface PurchaseRow {
  id: number;
  vendor_id: number;
  vendor_name: string;
  purchase_date: string;
  items: PurchaseItem[];
}

export default function PurchasesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<PurchaseRow | null>(null);

  const filters = useMemo(() => ({ search }), [search]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<PurchaseRow>("/purchases", filters);

  async function remove(p: PurchaseRow) {
    if (!confirm(`Delete this purchase from "${p.vendor_name}"? This reverses the stock it added.`)) return;
    try {
      await api(`/purchases/${p.id}`, { method: "DELETE" });
      toast("Purchase deleted", "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function itemsLabel(items: PurchaseItem[]): string {
    if (!items || items.length === 0) return "—";
    const parts = items.slice(0, 2).map((it) => `${it.name}${it.color ? ` (${it.color})` : ""} · ${fmtQty(it.qty)} ${it.unit}`);
    return parts.join(", ");
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Purchases"
        subtitle="Raw material received from vendors — stock updates automatically."
        count={total}
        actions={
          <Link
            href="/purchases/new"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-sm hover:bg-primary-hover"
          >
            <Icon.Plus /> <span className="hidden sm:inline">New Purchase</span>
          </Link>
        }
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by vendor / bill number…" />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No purchases found" hint="Try a different search." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Items</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="cursor-pointer" onClick={() => router.push(`/purchases/new?edit=${p.id}`)}>
                      <td className="text-muted">{formatDate(p.purchase_date)}</td>
                      <td className="font-medium text-ink">{p.vendor_name}</td>
                      <td className="max-w-[26rem] truncate text-muted">
                        {itemsLabel(p.items)}
                        {p.items && p.items.length > 2 && (
                          <span className="text-muted/70"> +{p.items.length - 2} more</span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <button onClick={(e) => { e.stopPropagation(); setPaying(p); }} className="inline-flex cursor-pointer items-center rounded-md bg-primary-tint px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-fg">Pay</button>
                          <button onClick={() => router.push(`/purchases/new?edit=${p.id}`)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                          {user?.role === "owner" && (
                            <button onClick={() => remove(p)} className="inline-flex cursor-pointer items-center rounded-md bg-[color:var(--danger-tint)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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

      {paying && (
        <PayVendorModal
          vendorId={paying.vendor_id}
          vendorName={paying.vendor_name}
          onClose={() => setPaying(null)}
          onDone={() => setPaying(null)}
        />
      )}
    </div>
  );
}
