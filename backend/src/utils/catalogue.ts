import { query } from '../config/db.js';
import { AppError } from './http.js';

/**
 * A line on a purchase, job issue, job receipt or job return, reduced to the
 * catalogue facts that have to be true about it.
 */
export interface CatalogueLine {
  kind: 'item' | 'product';
  /** item_id for a raw-material line, product_id for a finished-goods line. */
  id: number;
  variant_id?: number | null;
  /** Only meaningful for raw-material lines — products have no unit catalogue. */
  unit?: string | null;
}

/**
 * Reject lines whose variant belongs to a different item/product, or whose unit
 * is not one this item is actually stocked in.
 *
 * Postgres cannot express either rule with a foreign key: `variant_id` references
 * item_variants(id), which says the variant EXISTS, not that it belongs to the
 * item on the same line. Nothing errors when they disagree — the movement is just
 * written under the wrong parent, so on-hand for one material silently splits
 * across a colour it does not have, or a unit it is not stocked in. Both are
 * invisible until a stock figure looks wrong months later.
 *
 * Set-based: two queries regardless of how many lines are being saved.
 */
export async function assertCatalogueLines(lines: CatalogueLine[]): Promise<void> {
  if (lines.length === 0) return;

  const items = lines.filter((l) => l.kind === 'item');
  const products = lines.filter((l) => l.kind === 'product');

  // ── variants must belong to the item / product on their own line ──
  const itemVar = items.filter((l) => l.variant_id != null);
  if (itemVar.length > 0) {
    const bad = await query<{ id: number; variant_id: number }>(
      `SELECT DISTINCT t.id, t.variant_id
       FROM unnest($1::int[], $2::int[]) AS t(id, variant_id)
       WHERE NOT EXISTS (
         SELECT 1 FROM item_variants v WHERE v.id = t.variant_id AND v.item_id = t.id
       )`,
      [itemVar.map((l) => l.id), itemVar.map((l) => l.variant_id)],
    );
    if (bad.rows.length > 0) {
      throw new AppError(400, 'A colour was chosen that does not belong to that raw material.');
    }
  }

  const prodVar = products.filter((l) => l.variant_id != null);
  if (prodVar.length > 0) {
    const bad = await query<{ id: number; variant_id: number }>(
      `SELECT DISTINCT t.id, t.variant_id
       FROM unnest($1::int[], $2::int[]) AS t(id, variant_id)
       WHERE NOT EXISTS (
         SELECT 1 FROM product_variants v WHERE v.id = t.variant_id AND v.product_id = t.id
       )`,
      [prodVar.map((l) => l.id), prodVar.map((l) => l.variant_id)],
    );
    if (bad.rows.length > 0) {
      throw new AppError(400, 'A variant was chosen that does not belong to that product.');
    }
  }

  // ── a raw material may only move in a unit it is stocked in ──
  const withUnit = items.filter((l) => l.unit != null && l.unit !== '');
  if (withUnit.length > 0) {
    const bad = await query<{ id: number; unit: string; name: string }>(
      `SELECT DISTINCT t.id, t.unit, i.name
       FROM unnest($1::int[], $2::text[]) AS t(id, unit)
       JOIN items i ON i.id = t.id
       WHERE NOT EXISTS (
         SELECT 1 FROM item_units u WHERE u.item_id = t.id AND u.unit = t.unit
       )`,
      [withUnit.map((l) => l.id), withUnit.map((l) => l.unit)],
    );
    if (bad.rows.length > 0) {
      const b = bad.rows[0]!;
      throw new AppError(400, `"${b.name}" is not stocked in "${b.unit}". Pick one of its units.`);
    }
  }
}
