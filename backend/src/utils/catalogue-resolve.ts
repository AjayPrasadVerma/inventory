import type { PoolClient } from 'pg';

/**
 * Turn a typed name, size and design into catalogue ids, creating what does not
 * exist yet.
 *
 * The entry sheets let the owner type a name instead of picking an id, because
 * being sent to another screen to build a product before recording something that
 * already physically happened is not how the shop works. Both the karigar log and
 * the purchase sheet need the same resolution, so it lives here rather than being
 * written twice and drifting.
 *
 * The important part is that the free text is normalised into the existing
 * catalogue tables — item_units / item_variants for raw, product_variants for
 * finished. Every stock query, report and dashboard counter is keyed on those
 * tables, so normalising on write is what keeps all of them working untouched.
 */

export type CatalogueKind = 'item' | 'product';

export interface TypedLine {
  name: string;
  size?: string | null;
  design?: string | null;
}

/** Case-insensitive find, else insert. Returns the catalogue row's id. */
export async function findOrCreateCatalogue(
  client: PoolClient,
  kind: CatalogueKind,
  name: string,
): Promise<number> {
  const table = kind === 'item' ? 'items' : 'products';
  const found = await client.query<{ id: number }>(
    `SELECT id FROM ${table} WHERE lower(name) = lower($1) AND is_active LIMIT 1`,
    [name],
  );
  if (found.rows[0]) return found.rows[0].id;
  const made = await client.query<{ id: number }>(
    `INSERT INTO ${table} (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return made.rows[0]!.id;
}

/**
 * A raw-material line. Size carries the unit and design carries the colour,
 * which is exactly the shape items already had — so nothing about raw stock
 * needs to change.
 */
export async function resolveRawLine(
  client: PoolClient,
  line: TypedLine,
): Promise<{ itemId: number; unit: string; variantId: number | null }> {
  const itemId = await findOrCreateCatalogue(client, 'item', line.name);
  const unit = (line.size ?? '').trim() || 'pcs';

  await client.query(
    `INSERT INTO item_units (item_id, unit) VALUES ($1,$2) ON CONFLICT (item_id, unit) DO NOTHING`,
    [itemId, unit],
  );

  const design = (line.design ?? '').trim();
  if (!design) return { itemId, unit, variantId: null };

  await client.query(
    `INSERT INTO item_variants (item_id, color) VALUES ($1,$2) ON CONFLICT (item_id, color) DO NOTHING`,
    [itemId, design],
  );
  const v = await client.query<{ id: number }>(
    `SELECT id FROM item_variants WHERE item_id = $1 AND color = $2`,
    [itemId, design],
  );
  return { itemId, unit, variantId: v.rows[0]?.id ?? null };
}

/**
 * A finished-goods line. product_variants held size and design jammed into one
 * `variant` text field; migration 010 split them into columns and keeps `variant`
 * as the composed display label so older readers still work.
 */
export async function resolveFinishedLine(
  client: PoolClient,
  line: TypedLine,
): Promise<{ productId: number; variantId: number | null }> {
  const productId = await findOrCreateCatalogue(client, 'product', line.name);
  const size = (line.size ?? '').trim();
  const design = (line.design ?? '').trim();
  if (!size && !design) return { productId, variantId: null };

  const label = [size, design].filter(Boolean).join(' · ');
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM product_variants
     WHERE product_id = $1
       AND COALESCE(size,'') = $2
       AND COALESCE(design,'') = $3
     LIMIT 1`,
    [productId, size, design],
  );
  if (existing.rows[0]) return { productId, variantId: existing.rows[0].id };

  const made = await client.query<{ id: number }>(
    `INSERT INTO product_variants (product_id, variant, size, design)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (product_id, variant) DO UPDATE SET size = EXCLUDED.size, design = EXCLUDED.design
     RETURNING id`,
    [productId, label, size || null, design || null],
  );
  return { productId, variantId: made.rows[0]!.id };
}

/**
 * Which catalogue a typed name already belongs to, if either. A brand-new name
 * belongs to neither, and the caller decides the default — for a purchase that
 * is raw material, since that is the overwhelming case.
 */
export async function kindOfName(
  client: PoolClient,
  name: string,
): Promise<CatalogueKind | null> {
  const asProduct = await client.query(
    `SELECT 1 FROM products WHERE lower(name) = lower($1) AND is_active LIMIT 1`,
    [name],
  );
  if (asProduct.rowCount) return 'product';
  const asItem = await client.query(
    `SELECT 1 FROM items WHERE lower(name) = lower($1) AND is_active LIMIT 1`,
    [name],
  );
  return asItem.rowCount ? 'item' : null;
}
