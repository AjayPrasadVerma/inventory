"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";

export function CustomerReceiveModal({
  customerId,
  customerName,
  onClose,
  onDone,
}: {
  customerId: number;
  customerName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(() => todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!(Number(amount) > 0)) {
      toast("Enter an amount", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/payments", {
        method: "POST",
        body: {
          party_type: "customer",
          party_id: customerId,
          amount: Number(amount),
          direction: "received",
          pay_date: payDate,
          ref_note: note || undefined,
        },
      });
      toast("Payment received", "success");
      onDone();
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
      title={`Receive from ${customerName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !(Number(amount) > 0)}>
            {saving ? <Spinner /> : "Receive"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
        <Field label="Date">
          <DateField value={payDate} onChange={setPayDate} max={todayISO()} ariaLabel="Payment date" />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
