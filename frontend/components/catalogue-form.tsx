"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { TagInput } from "@/components/ui/tag-input";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";

export type CatalogueKind = "item" | "product";

export interface CatalogueRecord {
  kind: CatalogueKind;
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  units: string[];
  variants: string[];
}

/**
 * One form for everything the shop stocks.
 *
 * The owner treats raw material and finished goods as one idea — both are things
 * on the shelf — so there is a single Add form with a Type at the top. They stay
 * two records underneath, because the rest of the system depends on the
 * difference: a karigar is issued RAW and returns FINISHED, and the two stocks
 * live in different tables.
 *
 * Type is fixed once saved. Converting a record would mean moving its stock
 * history to the other table, and nothing downstream expects that.
 */
export function CatalogueForm({
  record,
  categories,
  unitOptions,
  onClose,
  onSaved,
}: {
  record: CatalogueRecord | null;
  categories: string[];
  unitOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const editing = record !== null;

  const [kind, setKind] = useState<CatalogueKind>(record?.kind ?? "item");
  const [name, setName] = useState(record?.name ?? "");
  const [category, setCategory] = useState(record?.category ?? "");
  const [lowStock, setLowStock] = useState(record?.low_stock_qty ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [saving, setSaving] = useState(false);

  // Raw material: many units, colours tracked separately.
  const [units, setUnits] = useState<string[]>(record?.units ?? []);
  // Colours for a raw material, sizes/designs for a product — one control either way.
  const [variants, setVariants] = useState<string[]>(record?.variants ?? []);

  // Opening stock is a one-time onboarding adjustment, so create-only.
  const [rawOpening, setRawOpening] = useState<{ color: string; unit: string; qty: string }[]>([]);
  const [prodOpening, setProdOpening] = useState<Record<string, string>>({});
  const [prodOpeningSingle, setProdOpeningSingle] = useState("");

  const isRaw = kind === "item";

  function addRawRow() {
    setRawOpening((r) => [...r, { color: variants[0] ?? "", unit: units[0] ?? "", qty: "" }]);
  }
  function setRawRow(i: number, k: "color" | "unit" | "qty", v: string) {
    setRawOpening((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  }

  async function save() {
    if (!name.trim()) { toast("Name is required", "error"); return; }
    if (isRaw && units.length === 0) { toast("Add at least one unit", "error"); return; }
    setSaving(true);
    try {
      const common = {
        name,
        category: category || null,
        low_stock_qty: lowStock === "" ? null : Number(lowStock),
        notes,
      };

      if (isRaw) {
        const opening = editing ? [] : rawOpening
          .map((r) => ({ color: variants.length > 0 ? (r.color || null) : null, unit: r.unit, qty: Number(r.qty || 0) }))
          .filter((o) => o.qty > 0 && o.unit);
        const body = { ...common, units, variants, ...(opening.length ? { opening } : {}) };
        if (editing) await api(`/items/${record.id}`, { method: "PUT", body });
        else await api("/items", { method: "POST", body });
      } else {
        const opening = editing ? [] : (variants.length > 0
          ? variants.map((v) => ({ variant: v, qty: Number(prodOpening[v] || 0) })).filter((o) => o.qty > 0)
          : (Number(prodOpeningSingle) > 0 ? [{ variant: null, qty: Number(prodOpeningSingle) }] : []));
        const body = { ...common, variants, ...(opening.length ? { opening } : {}) };
        if (editing) await api(`/products/${record.id}`, { method: "PUT", body });
        else await api("/products", { method: "POST", body });
      }

      toast(editing ? "Saved" : isRaw ? "Raw material added" : "Product added", "success");
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
      size="xl"
      title={editing ? `Edit ${isRaw ? "raw material" : "product"}` : "New item"}
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save"}</Button>
        </>
      )}
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {/* Left: what the thing is. Right: how it is stocked. */}
        <div className="flex flex-col gap-4">
          <Field
            label="Type *"
            hint={editing
              ? "Can't be changed — the stock history lives with it"
              : "Raw material is issued to karigars; finished goods come back or are bought in"}
          >
            <Select value={kind} onChange={(e) => setKind(e.target.value as CatalogueKind)} disabled={editing}>
              <option value="item">Raw material</option>
              <option value="product">Finished product</option>
            </Select>
          </Field>

          <Field label="Name *">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder={isRaw ? "Velvet, Board…" : "Ring Box, Necklace Stand…"}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" hint="Type a new one if needed">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} list="catalogue-cats" />
              <datalist id="catalogue-cats">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Low-stock alert" hint="Warn at this level">
              <Input value={lowStock} onChange={(e) => setLowStock(e.target.value)} inputMode="decimal" />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          {isRaw && (
            <Field label="Units *" hint="meter / roll / kilo — as received">
              <TagInput value={units} onChange={setUnits} placeholder="meter…" suggestions={unitOptions} />
            </Field>
          )}

          <Field
            label={isRaw ? "Colours" : "Variants (size / design)"}
            hint={isRaw ? "Each colour is tracked separately" : undefined}
          >
            <TagInput
              value={variants}
              onChange={setVariants}
              placeholder={isRaw ? "Red, Blue…" : "Small, Large…"}
            />
          </Field>

          {!editing && (
            <Field label="Opening stock (optional)" hint="Stock you already have — added once as an adjustment">
              {isRaw ? (
                <div className="flex flex-col gap-2">
                  {rawOpening.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {variants.length > 0 && (
                        <div className="w-28 shrink-0">
                          <Select value={row.color} onChange={(e) => setRawRow(i, "color", e.target.value)}>
                            {variants.map((c) => <option key={c} value={c}>{c}</option>)}
                          </Select>
                        </div>
                      )}
                      <div className="w-24 shrink-0">
                        <Select value={row.unit} onChange={(e) => setRawRow(i, "unit", e.target.value)}>
                          {units.map((u) => <option key={u} value={u}>{u}</option>)}
                        </Select>
                      </div>
                      <Input value={row.qty} onChange={(e) => setRawRow(i, "qty", e.target.value)} inputMode="decimal" placeholder="Qty" />
                      <button
                        type="button"
                        onClick={() => setRawOpening((r) => r.filter((_, idx) => idx !== i))}
                        aria-label="Remove"
                        className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-[color:var(--danger)]"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addRawRow} disabled={units.length === 0}>
                    + Add opening stock
                  </Button>
                </div>
              ) : variants.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {variants.map((v) => (
                    <div key={v} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-sm text-muted">{v}</span>
                      <Input
                        value={prodOpening[v] ?? ""}
                        onChange={(e) => setProdOpening((o) => ({ ...o, [v]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Input value={prodOpeningSingle} onChange={(e) => setProdOpeningSingle(e.target.value)} inputMode="decimal" placeholder="0" />
              )}
            </Field>
          )}

        </div>
      </div>
    </Modal>
  );
}
