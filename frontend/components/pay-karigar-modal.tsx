"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { PAY_METHODS } from "@/components/pay-vendor-modal";

/**
 * Pay a karigar for one job. The job id is stored on the payment, so the khata
 * can answer "kis job ka paisa diya" instead of only showing a running total.
 */
export function PayKarigarModal({
  karigarId,
  karigarName,
  jobId,
  againstRef,
  onClose,
  onDone,
}: {
  karigarId: number;
  karigarName: string;
  jobId?: number | null;
  againstRef?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [payDate, setPayDate] = useState(() => todayISO());
  const [note, setNote] = useState(againstRef ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!(Number(amount) > 0)) { toast("Enter an amount greater than 0", "error"); return; }
    setSaving(true);
    try {
      await api("/payments", {
        method: "POST",
        body: {
          party_type: "karigar",
          party_id: karigarId,
          amount: Number(amount),
          direction: "paid",
          method,
          pay_date: payDate,
          ref_note: note.trim() || undefined,
          job_id: jobId ?? undefined,
        },
      });
      toast("Payment recorded", "success");
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
      title={`Pay ${karigarName}`}
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !(Number(amount) > 0)}>
            {saving ? <Spinner /> : "Record payment"}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        {againstRef && (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            For <span className="font-medium text-ink">{againstRef}</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹) *">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus placeholder="0" />
          </Field>
          <Field label="Mode">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Date">
          <DateField value={payDate} onChange={setPayDate} max={todayISO()} ariaLabel="Payment date" />
        </Field>
        <Field label="Reference / note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Job #12, cheque no." />
        </Field>
      </div>
    </Modal>
  );
}
