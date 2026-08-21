"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

interface Item {
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  units: string[];
  variants: string[];
  on_hand: { unit: string; qty: number }[];
}

export default function ItemsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [unitOptions, setUnitOptions] = useState<string[]>([]);
  const [catFilter, setCatFilter] = useState("");

  // The command palette links here as `?new=1`. Read it with useSearchParams so it
  // still fires when the palette navigates from this very page — changing only the
  // query string does not remount the segment, so a mount-only read would miss it.
  const wantsNew = useSearchParams().get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the form for a ?new=1 deep link
    setCreating(true);
    router.replace("/items", { scroll: false });
  }, [wantsNew, router]);

  const filters = useMemo(() => ({ search, sort: "name", category: catFilter }), [search, catFilter]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<Item>("/items", filters);

  useEffect(() => {
    api<{ data: string[] }>("/items/meta/categories").then((r) => setCategories(r.data)).catch(() => {});
    api<{ data: string[] }>("/items/meta/units").then((r) => setUnitOptions(r.data)).catch(() => {});
  }, [editing, creating]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api(`/items/${deleting.id}`, { method: "DELETE" });
      toast("Material deleted", "success");
      bustCache("/items/options");
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
        title="Raw Materials"
        subtitle="Cloth, board, foam… with units and colours."
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
                placeholder="Search materials by name…"
                aria-label="Search materials by name…"
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
              <Icon.Plus /> <span className="hidden sm:inline">Add Material</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No materials found" hint="Try a different search or category." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14 num">S.No.</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Units</th>
                  <th>Colours</th>
                  <th>Stock</th>
                  <th>Notes</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it, i) => (
                  <tr
                    key={it.id}
                    className="clickable align-top"
                    onClick={() => router.push(`/items/stock?i=${it.id}`)}
                    title="Open stock"
                  >
                    <td className="num text-muted">{(page - 1) * pageSize + i + 1}</td>
                    <td className="font-semibold text-ink">{it.name}</td>
                    <td>{it.category || <span className="text-muted">—</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {it.units.map((u) => <Badge key={u}>{u}</Badge>)}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {it.variants.length
                          ? it.variants.map((c) => <Badge key={c} tone="accent">{c}</Badge>)
                          : <span className="text-muted">—</span>}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {it.on_hand.length
                          ? it.on_hand.map((o, i) => <Badge key={i} tone="neutral">{fmtQty(o.qty)} {o.unit}</Badge>)
                          : <span className="text-muted">—</span>}
                      </div>
                    </td>
                    <td className="max-w-[16rem] truncate">{it.notes || <span className="text-muted">—</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setEditing(it)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                        {user?.role === "owner" && (
                          <button onClick={() => setDeleting(it)} className="inline-flex cursor-pointer items-center rounded-md bg-[color:var(--danger-tint)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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
        <ItemForm
          item={editing}
          categories={categories}
          unitOptions={unitOptions.length ? unitOptions : ["meter", "roll", "kilo", "piece"]}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); bustCache("/items/options"); reload(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete material?"
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

function ItemForm({
  item,
  categories,
  unitOptions,
  onClose,
  onSaved,
}: {
  item: Item | null;
  categories: string[];
  unitOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [lowStock, setLowStock] = useState(item?.low_stock_qty ?? "");
  const [units, setUnits] = useState<string[]>(item?.units ?? []);
  const [colors, setColors] = useState<string[]>(item?.variants ?? []);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [openingRows, setOpeningRows] = useState<{ color: string; unit: string; qty: string }[]>([]);
  const [saving, setSaving] = useState(false);

  function addOpen() { setOpeningRows((r) => [...r, { color: colors[0] ?? "", unit: units[0] ?? "", qty: "" }]); }
  function setOpen(i: number, k: "color" | "unit" | "qty", v: string) {
    setOpeningRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  }
  function rmOpen(i: number) { setOpeningRows((r) => r.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!name.trim()) { toast("Name is required", "error"); return; }
    if (units.length === 0) { toast("Add at least one unit", "error"); return; }
    setSaving(true);
    try {
      // Opening stock only when creating (a one-time onboarding adjustment).
      let openingPayload: { color: string | null; unit: string; qty: number }[] | undefined;
      if (!item) {
        openingPayload = openingRows
          .map((r) => ({ color: colors.length > 0 ? (r.color || null) : null, unit: r.unit, qty: Number(r.qty || 0) }))
          .filter((o) => o.qty > 0 && o.unit);
      }
      const body = {
        name, category: category || null,
        low_stock_qty: lowStock === "" ? null : Number(lowStock),
        units, variants: colors, notes,
        ...(openingPayload && openingPayload.length ? { opening: openingPayload } : {}),
      };
      if (item) await api(`/items/${item.id}`, { method: "PUT", body });
      else await api("/items", { method: "POST", body });
      toast(item ? "Material updated" : "Material added", "success");
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
      title={item ? "Edit Material" : "New Raw Material"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Velvet, Board…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" hint="Type a new one if needed">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} list="item-cats" />
            <datalist id="item-cats">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Low-stock alert" hint="Warn at this level">
            <Input value={lowStock} onChange={(e) => setLowStock(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <Field label="Units *" hint="meter / roll / kilo — as received">
          <TagInput value={units} onChange={setUnits} placeholder="meter…" suggestions={unitOptions} />
        </Field>
        <Field label="Colors / Variants" hint="Each colour is tracked separately">
          <TagInput value={colors} onChange={setColors} placeholder="Red, Blue…" />
        </Field>
        {!item && (
          <Field label="Opening stock (optional)" hint="Stock you already have — added once as an adjustment">
            <div className="flex flex-col gap-2">
              {openingRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  {colors.length > 0 && (
                    <div className="w-28 shrink-0">
                      <Select value={row.color} onChange={(e) => setOpen(i, "color", e.target.value)}>
                        {colors.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </div>
                  )}
                  <div className="w-24 shrink-0">
                    <Select value={row.unit} onChange={(e) => setOpen(i, "unit", e.target.value)}>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </Select>
                  </div>
                  <Input value={row.qty} onChange={(e) => setOpen(i, "qty", e.target.value)} inputMode="decimal" placeholder="Qty" />
                  <button type="button" onClick={() => rmOpen(i)} aria-label="Remove" className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-[color:var(--danger)]">✕</button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addOpen} disabled={units.length === 0}>
                + Add opening stock
              </Button>
            </div>
          </Field>
        )}
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
