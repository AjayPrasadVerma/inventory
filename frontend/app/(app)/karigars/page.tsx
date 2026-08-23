"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { bustCache } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { rupees } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { KarigarForm, type Karigar } from "@/components/karigar-form";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";

// Karigar shape + add/edit form live in components/karigar-form.tsx (shared with the account page).
export default function KarigarsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [editing, setEditing] = useState<Karigar | null>(null);
  const [creating, setCreating] = useState(false);
  const [productTypes, setProductTypes] = useState<string[]>([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [deleting, setDeleting] = useState<Karigar | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // The command palette links here as `?new=1`. Read it with useSearchParams so it
  // still fires when the palette navigates from this very page — changing only the
  // query string does not remount the segment, so a mount-only read would miss it.
  const wantsNew = useSearchParams().get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the form for a ?new=1 deep link
    setCreating(true);
    router.replace("/karigars", { scroll: false });
  }, [wantsNew, router]);

  const filters = useMemo(() => ({ search, sort: "name", productType: typeFilter }), [search, typeFilter]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<Karigar>("/karigars", filters);

  useEffect(() => {
    api<{ data: { productTypes: string[]; totalPaid: number } }>("/karigars/meta/summary")
      .then((r) => { setProductTypes(r.data.productTypes); setTotalPaid(r.data.totalPaid); })
      .catch(() => {});
  }, [editing, creating]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api(`/karigars/${deleting.id}`, { method: "DELETE" });
      toast("Karigar deleted", "success");
      bustCache("/karigars/options");
      setDeleting(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Karigars"
        subtitle={`Contractors and their accounts · total paid ${rupees(totalPaid)}`}
        count={total}
        actions={
          <>
            <div className="w-36 sm:w-44">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Product type">
                <option value="">All products</option>
                {productTypes.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
            <div className="relative w-40 sm:w-64 lg:w-80">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name / phone…"
                aria-label="Search karigars"
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink shadow-xs outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
            <Button onClick={() => setCreating(true)}>
              <Icon.Plus /> <span className="hidden sm:inline">Add Karigar</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No karigars found" hint="Try a different search or product filter." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14 num">S.No.</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Products</th>
                  <th>Notes</th>
                  <th className="num">Total paid</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k, i) => (
                    <tr
                      key={k.id}
                      className="clickable"
                      onClick={() => router.push(`/karigars/account?k=${k.id}`)}
                      title="Open account"
                    >
                      <td className="num text-muted">{(page - 1) * pageSize + i + 1}</td>
                      <td className="font-semibold text-ink">{k.name}</td>
                      <td>{k.phone || <span className="text-muted">—</span>}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {k.product_types.length
                            ? k.product_types.map((p) => <Badge key={p} tone="accent">{p}</Badge>)
                            : <span className="text-muted">—</span>}
                        </div>
                      </td>
                      <td className="max-w-[16rem] truncate">{k.notes || <span className="text-muted">—</span>}</td>
                      <td className="num font-medium text-[color:var(--success)]">{rupees(Number(k.total_paid) || 0)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setEditing(k)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                          {user?.role === "owner" && (
                            <button onClick={() => setDeleting(k)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-muted transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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

      {(creating || editing) && (
        <KarigarForm
          karigar={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); bustCache("/karigars/options"); reload(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete karigar?"
        message={<>Are you sure you want to delete <span className="font-semibold text-ink">{deleting?.name}</span>? This action cannot be undone.</>}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
