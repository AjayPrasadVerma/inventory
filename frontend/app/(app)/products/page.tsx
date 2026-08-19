"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { bustCache } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { qty as fmtQty } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { TagInput } from "@/components/ui/tag-input";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, Pagination } from "@/components/page-parts";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Icon } from "@/components/icons";

interface Product {
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  variants: string[];
  on_hand: number;
}

export default function ProductsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [catFilter, setCatFilter] = useState("");

  const filters = useMemo(() => ({ search, sort: "name", category: catFilter }), [search, catFilter]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<Product>("/products", filters);

  useEffect(() => {
    api<{ data: string[] }>("/products/meta/categories").then((r) => setCategories(r.data)).catch(() => {});
  }, [editing, creating]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api(`/products/${deleting.id}`, { method: "DELETE" });
      toast("Product deleted", "success");
      bustCache("/products/options");
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
        title="Products"
        subtitle="Finished goods with size / design variants."
        count={total}
        actions={
          <>
            <div className="relative w-40 sm:w-60 lg:w-80">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products by name…"
                aria-label="Search products by name"
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink shadow-xs outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
            <div className="w-36 sm:w-44">
              <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Icon.Plus /> <span className="hidden sm:inline">Add Product</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No products found" hint="Try a different search or category." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14 num">S.No.</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Variants</th>
                  <th className="num">Stock</th>
                  <th>Notes</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr
                    key={p.id}
                    className="clickable align-top"
                    onClick={() => router.push(`/products/stock?p=${p.id}`)}
                    title="Open stock"
                  >
                    <td className="num text-muted">{(page - 1) * pageSize + i + 1}</td>
                    <td className="font-semibold text-ink">{p.name}</td>
                    <td>{p.category || <span className="text-muted">—</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.variants.length
                          ? p.variants.map((v) => <Badge key={v} tone="accent">{v}</Badge>)
                          : <span className="text-muted">—</span>}
                      </div>
                    </td>
                    <td className="num font-medium">
                      {Number(p.on_hand) < 0
                        ? <span className="text-[color:var(--danger)]">{fmtQty(p.on_hand)}</span>
                        : fmtQty(p.on_hand)}
                    </td>
                    <td className="max-w-[16rem] truncate">{p.notes || <span className="text-muted">—</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setEditing(p)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                        {user?.role === "owner" && (
                          <button onClick={() => setDeleting(p)} className="inline-flex cursor-pointer items-center rounded-md bg-[color:var(--danger-tint)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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
        <ProductForm
          product={editing}
          categories={categories}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); bustCache("/products/options"); reload(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete product?"
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

function ProductForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [lowStock, setLowStock] = useState(product?.low_stock_qty ?? "");
  const [variants, setVariants] = useState<string[]>(product?.variants ?? []);
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [opening, setOpening] = useState<Record<string, string>>({});
  const [openingSingle, setOpeningSingle] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast("Name is required", "error"); return; }
    setSaving(true);
    try {
      // Opening stock only when creating (a one-time onboarding adjustment).
      let openingPayload: { variant: string | null; qty: number }[] | undefined;
      if (!product) {
        openingPayload = variants.length > 0
          ? variants.map((v) => ({ variant: v, qty: Number(opening[v] || 0) })).filter((o) => o.qty > 0)
          : (Number(openingSingle) > 0 ? [{ variant: null, qty: Number(openingSingle) }] : []);
      }
      const body = {
        name, category: category || null,
        low_stock_qty: lowStock === "" ? null : Number(lowStock),
        variants, notes,
        ...(openingPayload && openingPayload.length ? { opening: openingPayload } : {}),
      };
      if (product) await api(`/products/${product.id}`, { method: "PUT", body });
      else await api("/products", { method: "POST", body });
      toast(product ? "Product updated" : "Product added", "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? "Edit Product" : "New Product"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ring Box, Necklace Stand…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" hint="Type a new one if needed">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} list="prod-cats" />
            <datalist id="prod-cats">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Low-stock alert">
            <Input value={lowStock} onChange={(e) => setLowStock(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <Field label="Variants (size / design)">
          <TagInput value={variants} onChange={setVariants} placeholder="Small, Large…" />
        </Field>
        {!product && (
          <Field label="Opening stock (optional)" hint="Stock you already have — added once as an adjustment">
            {variants.length > 0 ? (
              <div className="flex flex-col gap-2">
                {variants.map((v) => (
                  <div key={v} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-sm text-muted">{v}</span>
                    <Input value={opening[v] ?? ""} onChange={(e) => setOpening((o) => ({ ...o, [v]: e.target.value }))} inputMode="decimal" placeholder="0" />
                  </div>
                ))}
              </div>
            ) : (
              <Input value={openingSingle} onChange={(e) => setOpeningSingle(e.target.value)} inputMode="decimal" placeholder="0" />
            )}
          </Field>
        )}
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
