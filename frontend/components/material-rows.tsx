"use client";

import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Icon } from "@/components/icons";
import { rupees } from "@/lib/utils";

export interface ItemOpt {
  id: number;
  name: string;
  units: string[];
  variant_options: { id: number; color: string }[];
}
export interface ProductOpt {
  id: number;
  name: string;
  variant_options: { id: number; variant: string }[];
}

export interface MaterialLine {
  key: number;
  itemId: string;
  variantId: string;
  unit: string;
  qty: string;
}
export interface ProductLine {
  key: number;
  productId: string;
  variantId: string;
  qty: string;
}

let keySeq = 1;
export const blankMaterial = (): MaterialLine => ({ key: keySeq++, itemId: "", variantId: "", unit: "", qty: "" });
export const blankProduct = (): ProductLine => ({ key: keySeq++, productId: "", variantId: "", qty: "" });

export function materialPayload(lines: MaterialLine[]) {
  return lines
    .filter((l) => l.itemId && Number(l.qty) > 0 && l.unit)
    .map((l) => ({
      item_id: Number(l.itemId),
      variant_id: l.variantId ? Number(l.variantId) : null,
      unit: l.unit,
      qty: Number(l.qty),
    }));
}
export function productPayload(lines: ProductLine[]) {
  return lines
    .filter((l) => l.productId && Number(l.qty) > 0)
    .map((l) => ({
      product_id: Number(l.productId),
      variant_id: l.variantId ? Number(l.variantId) : null,
      qty: Number(l.qty),
    }));
}

/* Focus the material/product search input of a given visible row index. */
function focusRowSearch(container: HTMLElement | null, rowIndex: number) {
  if (!container) return;
  const inputs = container.querySelectorAll<HTMLInputElement>("[data-row-search] input");
  inputs[rowIndex]?.focus();
}

// Single column on a phone, the original template from sm up. Each cell prints
// its own label there — see .row-cell in globals.css.
const GRID_MATERIAL =
  "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_9rem_7rem_6.5rem_2.25rem] sm:items-center";
const GRID_PRODUCT =
  "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_11rem_6.5rem_2.25rem] sm:items-center";

export function MaterialRows({
  items,
  lines,
  setLines,
  invalidKeys,
}: {
  items: ItemOpt[];
  lines: MaterialLine[];
  setLines: React.Dispatch<React.SetStateAction<MaterialLine[]>>;
  invalidKeys?: Set<number>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const options = useMemo<ComboOption[]>(
    () => items.map((i) => ({ value: String(i.id), label: i.name, sublabel: i.units.join(" · ") })),
    [items],
  );

  function patch(key: number, p: Partial<MaterialLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function appendBlank() {
    setLines((ls) => [...ls, blankMaterial()]);
  }
  function onItem(key: number, itemId: string, isLast: boolean) {
    const item = byId.get(Number(itemId));
    patch(key, { itemId, variantId: "", unit: item?.units[0] ?? "" });
    if (itemId && isLast) appendBlank(); // always keep a trailing empty row ready
  }
  function onQtyEnter(rowIndex: number, isLast: boolean) {
    if (isLast) {
      appendBlank();
      setTimeout(() => focusRowSearch(containerRef.current, rowIndex + 1), 0);
    } else {
      focusRowSearch(containerRef.current, rowIndex + 1);
    }
  }

  // Duplicate detection (same item + color) for a gentle heads-up.
  const dupKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<number>();
    for (const l of lines) {
      if (!l.itemId) continue;
      const sig = `${l.itemId}::${l.variantId}`;
      if (seen.has(sig)) { dups.add(l.key); dups.add(seen.get(sig)!); }
      else seen.set(sig, l.key);
    }
    return dups;
  }, [lines]);

  const completeCount = lines.filter((l) => l.itemId && Number(l.qty) > 0 && l.unit).length;

  return (
    <div className="rounded-[14px] border border-border overflow-hidden bg-surface">
      <div className="overflow-x-auto">
        <div className="sm:min-w-[620px]">
          {/* header */}
          <div className={`${GRID_MATERIAL} hidden border-b border-border bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted sm:grid`}>
            <span>#</span>
            <span>Material</span>
            <span>Color</span>
            <span>Unit</span>
            <span className="text-right">Qty</span>
            <span />
          </div>

          {/* rows */}
          <div ref={containerRef} className="sm:max-h-[46vh] sm:overflow-y-auto">
            {lines.map((l, idx) => {
              const item = byId.get(Number(l.itemId));
              const isLast = idx === lines.length - 1;
              const invalid = invalidKeys?.has(l.key);
              const dup = dupKeys.has(l.key);
              return (
                <div
                  key={l.key}
                  className={`${GRID_MATERIAL} border-b border-border px-3 py-3 sm:py-1.5 border-b border-border last:border-b-0 ${invalid ? "bg-[color:var(--danger-tint)]" : dup ? "bg-[color:var(--warning-tint)]" : ""}`}
                >
                  <span className="text-xs font-semibold tabular-nums text-muted sm:font-normal">
                    <span className="sm:hidden">Line </span>{idx + 1}
                  </span>
                  <div className="row-cell" data-label="Material">
                    <div data-row-search>
                      <Combobox
                        size="sm"
                        options={options}
                        value={l.itemId}
                        onChange={(v) => onItem(l.key, v, isLast)}
                        placeholder="Search material…"
                        invalid={invalid && !l.itemId}
                        ariaLabel={`Material for row ${idx + 1}`}
                      />
                    </div>
                  </div>
                  <div className="row-cell" data-label="Color">
                    <Select
                      dense
                      value={l.variantId}
                      onChange={(e) => patch(l.key, { variantId: e.target.value })}
                      disabled={!item?.variant_options.length}
                      aria-label="Color"
                    >
                      <option value="">{item?.variant_options.length ? "Color…" : "—"}</option>
                      {item?.variant_options.map((v) => <option key={v.id} value={v.id}>{v.color}</option>)}
                    </Select>
                  </div>
                  <div className="row-cell" data-label="Unit">
                    <Select
                      dense
                      value={l.unit}
                      onChange={(e) => patch(l.key, { unit: e.target.value })}
                      disabled={!item}
                      invalid={invalid && !!l.itemId && !l.unit}
                      aria-label="Unit"
                    >
                      <option value="">Unit</option>
                      {item?.units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </Select>
                  </div>
                  <div className="row-cell" data-label="Qty">
                    <Input
                      dense
                      className="text-right"
                      placeholder="0"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => patch(l.key, { qty: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQtyEnter(idx, isLast); } }}
                      invalid={invalid && !!l.itemId && !(Number(l.qty) > 0)}
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="flex justify-end">
                    {lines.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove row ${idx + 1}`}>
                        <Icon.Trash />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-3 py-2">
            <Button variant="outline" size="sm" onClick={appendBlank}>
              <Icon.Plus /> Add material
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted">
              {dupKeys.size > 0 && (
                <span className="text-[color:var(--warning)]">Duplicate material rows highlighted</span>
              )}
              <span><span className="font-semibold text-ink tabular-nums">{completeCount}</span> material{completeCount === 1 ? "" : "s"} added</span>
            </div>
          </div>
        </div>
      </div>
      <p className="px-3 py-1.5 text-[11px] text-muted">Tip: pick a material, then press <kbd className="rounded border border-border bg-surface px-1">Enter</kbd> in Qty to jump to the next row.</p>
    </div>
  );
}

export function ProductRows({
  products,
  lines,
  setLines,
  invalidKeys,
}: {
  products: ProductOpt[];
  lines: ProductLine[];
  setLines: React.Dispatch<React.SetStateAction<ProductLine[]>>;
  invalidKeys?: Set<number>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const options = useMemo<ComboOption[]>(
    () => products.map((p) => ({ value: String(p.id), label: p.name })),
    [products],
  );

  function patch(key: number, p: Partial<ProductLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function appendBlank() {
    setLines((ls) => [...ls, blankProduct()]);
  }
  function onProduct(key: number, productId: string, isLast: boolean) {
    patch(key, { productId, variantId: "" });
    if (productId && isLast) appendBlank();
  }
  function onQtyEnter(rowIndex: number, isLast: boolean) {
    if (isLast) {
      appendBlank();
      setTimeout(() => focusRowSearch(containerRef.current, rowIndex + 1), 0);
    } else {
      focusRowSearch(containerRef.current, rowIndex + 1);
    }
  }

  const completeCount = lines.filter((l) => l.productId && Number(l.qty) > 0).length;

  return (
    <div className="rounded-[14px] border border-border overflow-hidden bg-surface">
      <div className="overflow-x-auto">
        <div className="sm:min-w-[560px]">
          <div className={`${GRID_PRODUCT} hidden border-b border-border bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted sm:grid`}>
            <span>#</span>
            <span>Product</span>
            <span>Variant</span>
            <span className="text-right">Qty</span>
            <span />
          </div>
          <div ref={containerRef} className="sm:max-h-[46vh] sm:overflow-y-auto">
            {lines.map((l, idx) => {
              const prod = byId.get(Number(l.productId));
              const isLast = idx === lines.length - 1;
              const invalid = invalidKeys?.has(l.key);
              return (
                <div
                  key={l.key}
                  className={`${GRID_PRODUCT} border-b border-border px-3 py-3 sm:py-1.5 border-b border-border last:border-b-0 ${invalid ? "bg-[color:var(--danger-tint)]" : ""}`}
                >
                  <span className="text-xs font-semibold tabular-nums text-muted sm:font-normal">
                    <span className="sm:hidden">Line </span>{idx + 1}
                  </span>
                  <div className="row-cell" data-label="Product">
                    <div data-row-search>
                      <Combobox
                        size="sm"
                        options={options}
                        value={l.productId}
                        onChange={(v) => onProduct(l.key, v, isLast)}
                        placeholder="Search product…"
                        invalid={invalid && !l.productId}
                        ariaLabel={`Product for row ${idx + 1}`}
                      />
                    </div>
                  </div>
                  <div className="row-cell" data-label="Variant">
                    <Select
                      dense
                      value={l.variantId}
                      onChange={(e) => patch(l.key, { variantId: e.target.value })}
                      disabled={!prod?.variant_options.length}
                      aria-label="Variant"
                    >
                      <option value="">{prod?.variant_options.length ? "Variant…" : "—"}</option>
                      {prod?.variant_options.map((v) => <option key={v.id} value={v.id}>{v.variant}</option>)}
                    </Select>
                  </div>
                  <div className="row-cell" data-label="Qty">
                    <Input
                      dense
                      className="text-right"
                      placeholder="0"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => patch(l.key, { qty: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQtyEnter(idx, isLast); } }}
                      invalid={invalid && !!l.productId && !(Number(l.qty) > 0)}
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="flex justify-end">
                    {lines.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove row ${idx + 1}`}>
                        <Icon.Trash />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-3 py-2">
            <Button variant="outline" size="sm" onClick={appendBlank}>
              <Icon.Plus /> Add product
            </Button>
            <span className="text-xs text-muted"><span className="font-semibold text-ink tabular-nums">{completeCount}</span> product{completeCount === 1 ? "" : "s"} added</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PricedRows — shared fast-entry table for lines that carry a money column
   (Purchases: item + color + unit + qty + rate; Sales: product + variant + qty + price).
--------------------------------------------------------------------------- */

export interface PricedItemOpt {
  id: number;
  name: string;
  units?: string[];                        // present → renders a Unit column
  variants: { id: number; label: string }[];
}
export interface PricedLine {
  key: number;
  /** Which catalogue the line is picked from — only used when `kinds` is passed. */
  kind: string;
  itemId: string;
  variantId: string;
  unit: string;
  qty: string;
  money: string;
}

/** One selectable catalogue for a line, e.g. raw materials vs finished products. */
export interface PricedKind {
  value: string;
  label: string;
  options: PricedItemOpt[];
}

let pricedSeq = 1;
export const blankPricedLine = (kind = "item"): PricedLine => ({ key: pricedSeq++, kind, itemId: "", variantId: "", unit: "", qty: "", money: "" });

export function pricedLineStatus(l: PricedLine, withUnit: boolean): "empty" | "complete" | "invalid" {
  const hasItem = !!l.itemId;
  const qtyStr = l.qty.trim();
  if (!hasItem && qtyStr === "") return "empty";
  if (hasItem && qtyStr !== "" && Number(qtyStr) > 0 && (!withUnit || !!l.unit)) return "complete";
  return "invalid";
}
export function pricedTotal(lines: PricedLine[]): number {
  return lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.money) || 0), 0);
}

export function PricedRows({
  options,
  lines,
  setLines,
  withUnit = false,
  moneyLabel,
  primaryLabel,
  primaryPlaceholder,
  variantPlaceholder = "Variant…",
  invalidKeys,
  kinds,
}: {
  options: PricedItemOpt[];
  lines: PricedLine[];
  setLines: React.Dispatch<React.SetStateAction<PricedLine[]>>;
  withUnit?: boolean;
  moneyLabel: string;        // "Rate" | "Price"
  primaryLabel: string;      // "Item" | "Product"
  primaryPlaceholder: string;
  variantPlaceholder?: string;
  invalidKeys?: Set<number>;
  /** Pass to let each line choose its catalogue (raw material vs finished product). */
  kinds?: PricedKind[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  /** id → option, per kind, so a line only resolves against its own catalogue. */
  const byKind = useMemo(() => {
    const list = kinds ?? [{ value: "item", label: primaryLabel, options }];
    return new Map(list.map((k) => [
      k.value,
      {
        byId: new Map(k.options.map((o) => [o.id, o])),
        combo: k.options.map((o) => ({
          value: String(o.id),
          label: o.name,
          sublabel: o.units?.length ? o.units.join(" · ") : undefined,
        })) as ComboOption[],
      },
    ]));
  }, [kinds, options, primaryLabel]);

  // Written out in full: Tailwind scans source text, so a class assembled from
  // a template literal is never emitted and the rows collapse to one column.
  const grid = kinds
    ? withUnit
      ? "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_8.5rem_minmax(0,1fr)_7.5rem_5.5rem_5rem_6rem_6.5rem_2.25rem] sm:items-center"
      : "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_8.5rem_minmax(0,1fr)_9rem_5.5rem_6.5rem_7rem_2.25rem] sm:items-center"
    : withUnit
      ? "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_7.5rem_5.5rem_5rem_6rem_6.5rem_2.25rem] sm:items-center"
      : "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_9rem_5.5rem_6.5rem_7rem_2.25rem] sm:items-center";
  // The min width forces the horizontal scroll that makes the desktop grid work;
  // on a phone the rows stack instead, so it must not apply.
  const minW = kinds ? "sm:min-w-[840px]" : withUnit ? "sm:min-w-[720px]" : "sm:min-w-[640px]";

  function patch(key: number, p: Partial<PricedLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function appendBlank() {
    setLines((ls) => [...ls, blankPricedLine(kinds?.[0]?.value ?? "item")]);
  }
  function onPrimary(key: number, kind: string, itemId: string, isLast: boolean) {
    const item = byKind.get(kind)?.byId.get(Number(itemId));
    // A catalogue with no units is counted in pieces — fill it in so the line is
    // complete without asking for a unit that has only one possible value.
    const unit = withUnit ? (item?.units?.length ? item.units[0]! : "pcs") : "";
    patch(key, { itemId, variantId: "", unit });
    if (itemId && isLast) appendBlank();
  }

  /** Switching a line's catalogue clears the pick — ids are not comparable across kinds. */
  function onKind(key: number, kind: string) {
    patch(key, { kind, itemId: "", variantId: "", unit: "" });
  }
  function onMoneyEnter(rowIndex: number, isLast: boolean) {
    if (isLast) {
      appendBlank();
      setTimeout(() => focusRowSearch(containerRef.current, rowIndex + 1), 0);
    } else {
      focusRowSearch(containerRef.current, rowIndex + 1);
    }
  }

  const completeCount = lines.filter((l) => pricedLineStatus(l, withUnit) === "complete").length;
  const total = pricedTotal(lines);

  return (
    <div className="rounded-[14px] border border-border overflow-hidden bg-surface">
      <div className="overflow-x-auto">
        <div className={minW}>
          {/* header */}
          <div className={`${grid} hidden border-b border-border bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted sm:grid`}>
            <span>#</span>
            {kinds && <span>Type</span>}
            <span>{primaryLabel}</span>
            <span>{withUnit ? "Color" : "Variant"}</span>
            {withUnit && <span>Unit</span>}
            <span className="text-right">Qty</span>
            <span className="text-right">{moneyLabel}</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          {/* rows */}
          <div ref={containerRef} className="sm:max-h-[42vh] sm:overflow-y-auto">
            {lines.map((l, idx) => {
              const cat = byKind.get(l.kind) ?? [...byKind.values()][0]!;
              const item = cat.byId.get(Number(l.itemId));
              const isLast = idx === lines.length - 1;
              const invalid = invalidKeys?.has(l.key);
              const amt = (Number(l.qty) || 0) * (Number(l.money) || 0);
              return (
                <div key={l.key} className={`${grid} border-b border-border px-3 py-3 last:border-b-0 sm:py-1.5 ${invalid ? "bg-[color:var(--danger-tint)]" : ""}`}>
                  <span className="text-xs font-semibold tabular-nums text-muted sm:font-normal">
                    <span className="sm:hidden">Line </span>{idx + 1}
                  </span>
                  {kinds && (
                    <div className="row-cell" data-label="Type">
                      <Select dense value={l.kind} onChange={(e) => onKind(l.key, e.target.value)} aria-label={`Type for row ${idx + 1}`}>
                        {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </Select>
                    </div>
                  )}
                  <div className="row-cell" data-label={primaryLabel}>
                    <div data-row-search>
                      <Combobox
                        size="sm"
                        options={cat.combo}
                        value={l.itemId}
                        onChange={(v) => onPrimary(l.key, l.kind, v, isLast)}
                        placeholder={primaryPlaceholder}
                        invalid={invalid && !l.itemId}
                        ariaLabel={`${primaryLabel} for row ${idx + 1}`}
                      />
                    </div>
                  </div>
                  <div className="row-cell" data-label={withUnit ? "Color" : "Variant"}>
                    <Select
                      dense
                      value={l.variantId}
                      onChange={(e) => patch(l.key, { variantId: e.target.value })}
                      disabled={!item?.variants.length}
                      aria-label={withUnit ? "Color" : "Variant"}
                    >
                      <option value="">{item?.variants.length ? variantPlaceholder : "—"}</option>
                      {item?.variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </Select>
                  </div>
                  {withUnit && (
                    <div className="row-cell" data-label="Unit">
                      <Select
                        dense
                        value={l.unit}
                        onChange={(e) => patch(l.key, { unit: e.target.value })}
                        disabled={!item || !item.units?.length}
                        invalid={invalid && !!l.itemId && !l.unit}
                        aria-label="Unit"
                      >
                        {item && !item.units?.length
                          ? <option value="pcs">pcs</option>
                          : <><option value="">Unit</option>{item?.units?.map((u) => <option key={u} value={u}>{u}</option>)}</>}
                      </Select>
                    </div>
                  )}
                  <div className="row-cell" data-label="Qty">
                    <Input
                      dense className="text-right" placeholder="0" inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => patch(l.key, { qty: e.target.value })}
                      invalid={invalid && !!l.itemId && !(Number(l.qty) > 0)}
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="row-cell" data-label={moneyLabel}>
                    <Input
                      dense className="text-right" placeholder="0" inputMode="decimal"
                      value={l.money}
                      onChange={(e) => patch(l.key, { money: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onMoneyEnter(idx, isLast); } }}
                      aria-label={moneyLabel}
                    />
                  </div>
                  <div className="row-cell" data-label="Amount">
                    <span className="text-sm font-semibold text-ink tabular-nums sm:block sm:text-right sm:font-medium">{amt > 0 ? rupees(amt) : "—"}</span>
                  </div>
                  <div className="flex justify-end">
                    {lines.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove row ${idx + 1}`}>
                        <Icon.Trash />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-3 py-2">
            <Button variant="outline" size="sm" onClick={appendBlank}>
              <Icon.Plus /> Add {primaryLabel.toLowerCase()}
            </Button>
            <div className="flex items-center gap-4 text-xs text-muted">
              <span><span className="font-semibold text-ink tabular-nums">{completeCount}</span> {primaryLabel.toLowerCase()}{completeCount === 1 ? "" : "s"}</span>
              <span>Total <span className="text-sm font-semibold text-ink tabular-nums">{rupees(total)}</span></span>
            </div>
          </div>
        </div>
      </div>
      <p className="px-3 py-1.5 text-[11px] text-muted">Tip: press <kbd className="rounded border border-border bg-surface px-1">Enter</kbd> in {moneyLabel} to jump to the next row.</p>
    </div>
  );
}
