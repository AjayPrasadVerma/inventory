"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { TagInput } from "@/components/ui/tag-input";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";

export interface Karigar {
  id: number;
  name: string;
  phone: string | null;
  product_types: string[];
  notes: string | null;
  total_paid?: string;
}

/** Add / edit a karigar. Shared by the karigars list and the karigar account page. */
export function KarigarForm({
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
      const body = { name, phone, product_types: productTypes, notes };
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
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save"}</Button>
        </>
      )}
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
