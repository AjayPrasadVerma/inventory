"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { qty as fmtQty } from "@/lib/utils";
import { useServerList } from "@/lib/use-server-list";
import { bustCache } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";
import { CatalogueForm, type CatalogueKind, type CatalogueRecord } from "@/components/catalogue-form";

interface Row extends CatalogueRecord {
  on_hand: { unit: string; qty: number }[];
}

const KIND_LABEL: Record<CatalogueKind, string> = { item: "Raw material", product: "Finished" };
const KIND_TONE: Record<CatalogueKind, string> = {
  item: "bg-[color:var(--accent-tint)] text-[color:var(--accent)]",
  product: "bg-[color:var(--success-tint)] text-[color:var(--success)]",
};

/**
 * One list for everything the shop stocks. Raw material and finished goods are
 * still separate records — a karigar is issued RAW and returns FINISHED, and the
 * two stocks live in different tables — but the owner thinks of them as one
 * catalogue, so they are shown and created as one.
 */
export default function CataloguePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"" | CatalogueKind>("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [unitOptions, setUnitOptions] = useState<string[]>([]);

  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    api<{ data: string[] }>("/catalogue/meta/categories").then((r) => setCategories(r.data)).catch(() => {});
    api<{ data: string[] }>("/items/meta/units").then((r) => setUnitOptions(r.data)).catch(() => {});
  }, []);

  // The command palette links here as `?new=1`; read it reactively so it fires
  // even when we are already on this page.
  const wantsNew = useSearchParams().get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the form for a ?new=1 deep link
    setCreating(true);
    router.replace("/products", { scroll: false });
  }, [wantsNew, router]);

  const filters = useMemo(() => ({ search, kind, category, sort: "name" }), [search, kind, category]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<Row>("/catalogue", filters);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api(`/${deleting.kind === "item" ? "items" : "products"}/${deleting.id}`, { method: "DELETE" });
      toast("Deleted", "success");
      bustCache("/items/options");
      bustCache("/products/options");
      setDeleting(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  const stockHref = (r: Row) => (r.kind === "item" ? `/items/stock?i=${r.id}` : `/products/stock?p=${r.id}`);

  return (
    <div className="w-full">
      <PageHeader
        title="Products"
        subtitle="Everything you stock — raw material and finished goods."
        count={total}
        actions={
          <>
            <div className="relative min-w-0 basis-full sm:w-56 sm:basis-auto lg:w-72">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name…"
                aria-label="Search products and materials"
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink shadow-xs outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
            <div className="min-w-0 flex-1 sm:w-36 sm:flex-none">
              <Select value={kind} onChange={(e) => setKind(e.target.value as "" | CatalogueKind)} aria-label="Type">
                <option value="">All types</option>
                <option value="item">Raw material</option>
                <option value="product">Finished</option>
              </Select>
            </div>
            <div className="min-w-0 flex-1 sm:w-36 sm:flex-none">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Icon.Plus /> <span className="hidden sm:inline">Add</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing found" hint="Use 'Add' above to create a raw material or a finished product." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table stacked">
                <thead>
                  <tr>
                    <th className="w-14 num">S.No.</th>
                    <th>Name</th>
                    <th className="w-32">Type</th>
                    <th>Category</th>
                    <th>Units</th>
                    <th>Colours / Variants</th>
                    <th className="num">In stock</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const oversold = r.on_hand.some((o) => o.qty < 0);
                    return (
                      <tr
                        key={`${r.kind}-${r.id}`}
                        className="clickable"
                        onClick={() => router.push(stockHref(r))}
                        title="Open stock"
                      >
                        <td data-label="S.No." className="num text-muted">{(page - 1) * pageSize + i + 1}</td>
                        <td className="font-semibold text-ink">{r.name}</td>
                        <td data-label="Type">
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${KIND_TONE[r.kind]}`}>
                            {KIND_LABEL[r.kind]}
                          </span>
                        </td>
                        <td data-label="Category">{r.category || <span className="text-muted">—</span>}</td>
                        <td data-label="Units">{r.units.length > 0 ? r.units.join(", ") : <span className="text-muted">—</span>}</td>
                        <td data-label="Colours" className="max-w-[16rem] truncate">
                          {r.variants.length > 0 ? r.variants.join(", ") : <span className="text-muted">—</span>}
                        </td>
                        <td data-label="In stock" className={`num font-medium ${oversold ? "text-[color:var(--danger)]" : ""}`}>
                          {r.on_hand.length === 0
                            ? <span className="text-muted">—</span>
                            : r.on_hand.map((o) => `${fmtQty(o.qty)} ${o.unit}`).join(", ")}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => setEditing(r)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                            {user?.role === "owner" && (
                              <button onClick={() => setDeleting(r)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-muted transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
                            )}
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

      {(creating || editing) && (
        <CatalogueForm
          record={editing}
          categories={categories}
          unitOptions={unitOptions}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            bustCache("/items/options");
            bustCache("/products/options");
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.kind === "item" ? "Delete raw material?" : "Delete product?"}
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
