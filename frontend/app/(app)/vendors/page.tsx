"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useServerList } from "@/lib/use-server-list";
import { bustCache } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader, SearchBar, Pagination } from "@/components/page-parts";
import { Icon } from "@/components/icons";

interface Vendor {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  gst_no: string | null;
  notes: string | null;
  balance: string;
}

export default function VendorsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => ({ search, sort: "name" }), [search]);
  const { rows, total, loading, page, setPage, pageSize, setPageSize, reload } = useServerList<Vendor>("/vendors", filters);

  async function remove(v: Vendor) {
    if (!confirm(`Delete "${v.name}"?`)) return;
    try {
      await api(`/vendors/${v.id}`, { method: "DELETE" });
      toast("Vendor deleted", "success");
      bustCache("/vendors/options");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Vendors"
        subtitle="Raw material suppliers and their accounts."
        count={total}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Icon.Plus /> <span className="hidden sm:inline">Add Vendor</span>
          </Button>
        }
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name / phone / city…" />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No vendors found" hint="Use 'Add Vendor' above to create one." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>City</th>
                  <th>Phone</th>
                  <th>Notes</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                    <tr key={v.id}>
                      <td className="font-medium text-ink">{v.name}</td>
                      <td className="text-muted">{v.city || "—"}</td>
                      <td className="text-muted">{v.phone || "—"}</td>
                      <td className="max-w-[22rem] truncate text-muted">{v.notes || "—"}</td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => router.push(`/vendors/account?v=${v.id}`)} className="inline-flex cursor-pointer items-center rounded-md bg-primary-tint px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-fg">Account</button>
                          <button onClick={() => setEditing(v)} className="inline-flex cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                          {user?.role === "owner" && (
                            <button onClick={() => remove(v)} className="inline-flex cursor-pointer items-center rounded-md bg-[color:var(--danger-tint)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)] hover:text-white">Delete</button>
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
        <VendorForm
          vendor={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            bustCache("/vendors/options");
            reload();
          }}
        />
      )}

    </div>
  );
}

function VendorForm({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: vendor?.name ?? "",
    phone: vendor?.phone ?? "",
    city: vendor?.city ?? "",
    address: vendor?.address ?? "",
    gst_no: vendor?.gst_no ?? "",
    notes: vendor?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      if (vendor) await api(`/vendors/${vendor.id}`, { method: "PUT", body: form });
      else await api("/vendors", { method: "POST", body: form });
      toast(vendor ? "Vendor updated" : "Vendor added", "success");
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
      title={vendor ? "Edit Vendor" : "New Vendor"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name *">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
        </div>
        <Field label="Address">
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="GST No.">
          <Input value={form.gst_no} onChange={(e) => set("gst_no", e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

