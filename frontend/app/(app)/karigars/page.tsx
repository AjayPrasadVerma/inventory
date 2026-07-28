"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { bustCache } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { rupees } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { TagInput } from "@/components/ui/tag-input";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, SearchBar, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";

interface Karigar {
  id: number;
  name: string;
  phone: string | null;
  product_types: string[];
  notes: string | null;
  total_paid: string;
}

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

  const filters = useMemo(() => ({ search, sort: "name", productType: typeFilter }), [search, typeFilter]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<Karigar>("/karigars", filters);

  useEffect(() => {
    api<{ data: { productTypes: string[]; totalPaid: number } }>("/karigars/meta/summary")
      .then((r) => { setProductTypes(r.data.productTypes); setTotalPaid(r.data.totalPaid); })
      .catch(() => {});
  }, [editing, creating]);

  async function remove(k: Karigar) {
    if (!confirm(`Delete "${k.name}"?`)) return;
    try {
      await api(`/karigars/${k.id}`, { method: "DELETE" });
      toast("Karigar deleted", "success");
      bustCache("/karigars/options");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Karigars"
        subtitle="Karigars / contractors and their accounts."
        count={total}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Icon.Plus /> <span className="hidden sm:inline">Add Karigar</span>
          </Button>
        }
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name / phone…">
        <div className="w-full shrink-0 sm:w-48">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All products</option>
            {productTypes.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
      </SearchBar>

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Karigars</h2>
        <span className="text-sm">
          <span className="text-muted">Total paid: </span>
          <span className="font-semibold text-ink tabular-nums">{rupees(totalPaid)}</span>
        </span>
      </div>

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
                  <th>Name</th>
                  <th>Products</th>
                  <th>Phone</th>
                  <th>Notes</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => (
                    <tr key={k.id}>
                      <td className="font-medium text-ink">{k.name}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {k.product_types.length
                            ? k.product_types.map((p) => <Badge key={p} tone="accent">{p}</Badge>)
                            : <span className="text-muted">—</span>}
                        </div>
                      </td>
                      <td className="text-muted">{k.phone || "—"}</td>
                      <td className="max-w-[22rem] truncate text-muted">{k.notes || "—"}</td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => router.push(`/karigars/account?k=${k.id}`)} className="inline-flex cursor-pointer items-center rounded-md bg-primary-tint px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-fg">Account</button>
                          <button onClick={() => setEditing(k)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                          {user?.role === "owner" && (
                            <button onClick={() => remove(k)} className="inline-flex cursor-pointer items-center rounded-md bg-[color:var(--danger-tint)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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
    </div>
  );
}

function KarigarForm({
  karigar,
  onClose,
  onSaved,
}: {
  karigar: Karigar | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(karigar?.name ?? "");
  const [phone, setPhone] = useState(karigar?.phone ?? "");
  const [productTypes, setProductTypes] = useState<string[]>(karigar?.product_types ?? []);
  const [notes, setNotes] = useState(karigar?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast("Name is required", "error"); return; }
    setSaving(true);
    try {
      const body = {
        name, phone, product_types: productTypes,
        notes,
      };
      if (karigar) await api(`/karigars/${karigar.id}`, { method: "PUT", body });
      else await api("/karigars", { method: "POST", body });
      toast(karigar ? "Karigar updated" : "Karigar added", "success");
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
      title={karigar ? "Edit Karigar" : "New Karigar"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Products they make" hint="Type and press Enter (box, stand…)">
          <TagInput
            value={productTypes}
            onChange={setProductTypes}
            placeholder="box, stand…"
            suggestions={["Box", "Stand", "Tray", "Folder"]}
          />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
