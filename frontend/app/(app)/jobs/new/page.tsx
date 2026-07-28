"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateField } from "@/components/ui/date-field";
import { Card, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import {
  MaterialRows, blankMaterial, materialPayload,
  type ItemOpt, type MaterialLine,
} from "@/components/material-rows";

interface KarigarOpt { id: number; name: string; phone?: string | null }
interface RawStock { item_id: number; variant_id: number | null; unit: string; on_hand: string }

const stockKey = (itemId: number, variantId: number | null, unit: string) => `${itemId}:${variantId ?? 0}:${unit}`;

export default function NewJobPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [karigars, setKarigars] = useState<KarigarOpt[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [karigarId, setKarigarId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<MaterialLine[]>([blankMaterial()]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const [k, i, st] = await Promise.all([
        cachedGet<{ data: KarigarOpt[] }>("/karigars/options"),
        cachedGet<{ data: ItemOpt[] }>("/items/options"),
        cachedGet<{ data: RawStock[] }>("/reports/raw-stock"),
      ]);
      setKarigars(k.data);
      setItems(i.data);
      const map: Record<string, number> = {};
      for (const s of st.data) map[stockKey(s.item_id, s.variant_id, s.unit)] = Number(s.on_hand);
      setStock(map);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Could not load form data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state is set only after await
  useEffect(() => { loadOptions(); }, [loadOptions]);

  function retry() { setLoading(true); setLoadError(null); loadOptions(); }

  const karigarOptions = useMemo<ComboOption[]>(
    () => karigars.map((k) => ({ value: String(k.id), label: k.name, sublabel: k.phone || undefined })),
    [karigars],
  );

  // ---- Validation ----
  const lineStatus = useCallback((l: MaterialLine): "empty" | "complete" | "invalid" => {
    const hasItem = !!l.itemId;
    const qtyStr = l.qty.trim();
    const qtyNum = Number(qtyStr);
    if (!hasItem && qtyStr === "") return "empty";
    if (hasItem && l.unit && qtyStr !== "" && qtyNum > 0) return "complete";
    return "invalid";
  }, []);

  const errors = useMemo(() => {
    const invalidKeys = new Set<number>();
    let karigarErr: string | undefined;
    let materialErr: string | undefined;

    if (!karigarId) karigarErr = "Please select a karigar.";

    let complete = 0;
    for (const l of lines) {
      const st = lineStatus(l);
      if (st === "invalid") invalidKeys.add(l.key);
      if (st === "complete") complete++;
    }
    if (invalidKeys.size > 0) materialErr = "Some rows are incomplete — each needs a material, a unit, and a quantity greater than 0.";
    else if (complete === 0) materialErr = "Add at least one material with a quantity.";

    return { invalidKeys, karigarErr, materialErr, hasError: !!(karigarErr || materialErr) };
  }, [karigarId, lines, lineStatus]);

  const show = submitted;

  async function save() {
    setSubmitted(true);
    if (errors.hasError) {
      toast("Please fix the highlighted fields.", "error");
      return;
    }

    const issues = materialPayload(lines);

    // Soft oversell warning — total issued per material/variant/unit vs on-hand. Never blocks.
    const reqByKey = new Map<string, number>();
    for (const it of issues) {
      const key = stockKey(it.item_id, it.variant_id, it.unit);
      reqByKey.set(key, (reqByKey.get(key) ?? 0) + it.qty);
    }
    const oversold = [...reqByKey.entries()]
      .map(([key, need]) => {
        const have = stock[key] ?? 0;
        const [itemId, variantId] = key.split(":").map(Number);
        const it = issues.find((x) => stockKey(x.item_id, x.variant_id, x.unit) === key)!;
        const item = items.find((x) => x.id === itemId);
        const vlabel = variantId ? item?.variant_options.find((v) => v.id === variantId)?.color : "";
        return { label: `${item?.name ?? "Material"}${vlabel ? ` (${vlabel})` : ""} · ${it.unit}`, need, have };
      })
      .filter((o) => o.need > o.have);
    if (oversold.length > 0) {
      const detail = oversold.map((o) => `• ${o.label}: issuing ${o.need}, only ${o.have} in stock`).join("\n");
      if (!confirm(`Not enough stock for:\n\n${detail}\n\nStock will go negative (oversold). Save anyway?`)) return;
    }

    setSaving(true);
    try {
      await api("/jobs", {
        method: "POST",
        body: {
          karigar_id: Number(karigarId),
          job_date: date,
          expected_note: expected.trim() || null,
          notes: notes.trim() || null,
          issues,
        },
      });
      toast("Job created — material issued.", "success");
      router.push("/jobs");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full pb-24">
      <PageHeader backHref="/jobs" title="New Karigar Job" subtitle="Issue raw materials to a karigar." />

      {loading ? (
        <Card className="flex items-center justify-center gap-3 p-12 text-sm text-muted">
          <Spinner /> Loading form…
        </Card>
      ) : loadError ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm font-medium text-ink">Could not load the form.</p>
          <p className="max-w-md text-sm text-muted">{loadError}</p>
          <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
        </Card>
      ) : (
        <>
          {karigars.length === 0 && (
            <div className="mb-4 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-tint)] px-4 py-3 text-sm text-ink">
              No karigars found. <Link href="/karigars" className="font-medium underline">Add a karigar</Link> first.
            </div>
          )}

          <Card className="p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <Field label="Karigar *" error={show ? errors.karigarErr : undefined}>
                  <Combobox
                    options={karigarOptions}
                    value={karigarId}
                    onChange={setKarigarId}
                    placeholder="Search karigar…"
                    invalid={show && !!errors.karigarErr}
                    ariaLabel="Karigar"
                  />
                </Field>
              </div>
              <Field label="Date">
                <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Date" />
              </Field>
              <div className="md:col-span-2 lg:col-span-2">
                <Field label="What to make (optional)">
                  <Input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="50 ring boxes, red velvet" />
                </Field>
              </div>
            </div>
          </Card>

          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">Material issued to the karigar</h2>
            <MaterialRows
              items={items}
              lines={lines}
              setLines={setLines}
              invalidKeys={show ? errors.invalidKeys : undefined}
            />
            {show && errors.materialErr && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2 text-xs font-medium text-[color:var(--danger)]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
                </svg>
                {errors.materialErr}
              </div>
            )}
          </div>

          <Card className="mt-4 p-5">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to note about this order…" />
            </Field>
          </Card>

          <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-border bg-background/85 py-3 backdrop-blur-sm">
            <Button variant="outline" onClick={() => router.push("/jobs")} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || karigars.length === 0}>
              {saving ? <><Spinner /> Saving…</> : "Create Job"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
