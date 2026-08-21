/** Minimal deterministic catalogue: one vendor, one karigar, one multi-unit raw
 *  material with a colour, one product with a variant. Enough to exercise both
 *  purchase kinds and the full job cycle. */
import { query } from './db.js';

export interface Fixtures {
  vendorId: number; karigarId: number;
  itemId: number; itemVariantId: number; itemUnit: string;
  productId: number; productVariantId: number;
}

export async function seedFixtures(): Promise<Fixtures> {
  const vendor = (await query<{ id: number }>(
    `INSERT INTO vendors (name, phone, city) VALUES ('Test Vendor','9000000001','Jaipur') RETURNING id`)).rows[0]!;
  const karigar = (await query<{ id: number }>(
    `INSERT INTO karigars (name, phone, product_types) VALUES ('Test Karigar','9000000002',ARRAY['Box']) RETURNING id`)).rows[0]!;

  const item = (await query<{ id: number }>(
    `INSERT INTO items (name, category) VALUES ('Test Velvet','Kapda') RETURNING id`)).rows[0]!;
  await query(`INSERT INTO item_units (item_id, unit, is_default) VALUES ($1,'meter',TRUE), ($1,'roll',FALSE)`, [item.id]);
  const itemVariant = (await query<{ id: number }>(
    `INSERT INTO item_variants (item_id, color) VALUES ($1,'Red') RETURNING id`, [item.id])).rows[0]!;

  const product = (await query<{ id: number }>(
    `INSERT INTO products (name, category) VALUES ('Test Ring Box','Box') RETURNING id`)).rows[0]!;
  const productVariant = (await query<{ id: number }>(
    `INSERT INTO product_variants (product_id, variant) VALUES ($1,'Small') RETURNING id`, [product.id])).rows[0]!;

  return {
    vendorId: vendor.id, karigarId: karigar.id,
    itemId: item.id, itemVariantId: itemVariant.id, itemUnit: 'meter',
    productId: product.id, productVariantId: productVariant.id,
  };
}

/** Raw on-hand for a fixture item, per unit. */
export async function rawOnHand(itemId: number, unit: string): Promise<number> {
  const r = await query<{ q: string | null }>(
    `SELECT SUM(qty)::text AS q FROM stock_movements WHERE item_id = $1 AND unit = $2`, [itemId, unit]);
  return Number(r.rows[0]?.q ?? 0);
}

/** Finished on-hand for a fixture product. */
export async function finishedOnHand(productId: number): Promise<number> {
  const r = await query<{ q: string | null }>(
    `SELECT SUM(qty)::text AS q FROM finished_stock_movements WHERE product_id = $1`, [productId]);
  return Number(r.rows[0]?.q ?? 0);
}
