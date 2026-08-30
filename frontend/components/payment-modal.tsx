"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { numeric } from "@/components/ui/entry-sheet";

interface Opt { id: number; name: string; phone: string | null }

const MODES = ["Cash", "UPI", "Bank", "Cheque"];

/**
 * Pay anyone, from the dashboard.
 *
 * The khata pages already have a pay form each, but those are for paying the
 * party whose page you are on — they take the party as a prop and can link the
 * payment to a bill or an entry. This one answers a different question: the owner
 * wants to record a payment and has not said to whom. So the party is a field in
 * the form, not a dialog in front of it.
 *
 * Karigars and vendors share one list with the type on each row, because the
 * owner is thinking of a person, not of which of two menus they live under.
 */
export function PaymentModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [karigars, setKarigars] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);

  const [party, setParty] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(MODES[0]!);
  const [payDate, setPayDate] = useState(() => todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cachedGet<{ data: Opt[] }>("/karigars/options").then((r) => setKarigars(r.data)).catch(() => {});
    cachedGet<{ data: Opt[] }>("/vendors/options").then((r) => setVendors(r.data)).catch(() => {});
  }, []);

  // The value carries its type, so two parties sharing a name — a person can be
  // both a karigar and a vendor — stay distinguishable.
  const options = useMemo<ComboOption[]>(() => [
    ...karigars.map((k) => ({
      value: `karigar:${k.id}`, label: k.name,
      sublabel: ["Karigar", k.phone].filter(Boolean).join(" · "),
    })),
    ...vendors.map((v) => ({
      value: `vendor:${v.id}`, label: v.name,
      sublabel: ["Vendor", v.phone].filter(Boolean).join(" · "),
    })),
  ], [karigars, vendors]);

  const partyName = options.find((o) => o.value === party)?.label ?? "";

  async function save() {
    if (!party) { toast("Choose who you are paying", "error"); return; }
    if (!(Number(amount) > 0)) { toast("Enter an amount greater than 0", "error"); return; }
    const [partyType, id] = party.split(":");
    setSaving(true);
    try {
      await api("/payments", {
        method: "POST",
        body: {
          party_type: partyType,
          party_id: Number(id),
          amount: Number(amount),
          direction: "paid",
          method,
          pay_date: payDate,
          ref_note: note.trim() || undefined,
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
      title={partyName ? `Pay ${partyName}` : "Record a payment"}
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !party || !(Number(amount) > 0)}>
            {saving ? <Spinner /> : "Record payment"}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="Paying *">
          <Combobox
            options={options}
            value={party}
            onChange={setParty}
            placeholder="Search karigar or vendor…"
            ariaLabel="Who are you paying"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹) *">
            <Input value={amount} onChange={(e) => setAmount(numeric(e.target.value))} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Mode">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Date">
          <DateField value={payDate} onChange={setPayDate} max={todayISO()} />
        </Field>

        <Field label="Reference / note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is this for…" />
        </Field>
      </div>
    </Modal>
  );
}
