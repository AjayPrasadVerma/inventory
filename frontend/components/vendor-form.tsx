"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";

export interface Vendor {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  gst_no: string | null;
  notes: string | null;
  opening_balance: string;
  balance?: string;
}

/** Add / edit a vendor. Shared by the vendors list and the vendor account page. */
export function VendorForm({
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
    opening_balance: vendor?.opening_balance && Number(vendor.opening_balance) !== 0 ? String(Number(vendor.opening_balance)) : "",
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
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : "Save"}
          </Button>
        </>
      )}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST No.">
            <Input value={form.gst_no} onChange={(e) => set("gst_no", e.target.value)} />
          </Field>
          <Field label="Opening balance (₹)">
            <Input value={form.opening_balance} onChange={(e) => set("opening_balance", e.target.value)} inputMode="decimal" placeholder="0" />
          </Field>
        </div>
        <p className="-mt-1 text-xs text-muted">Amount already payable to this vendor before you start recording purchases. Leave blank if none.</p>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
