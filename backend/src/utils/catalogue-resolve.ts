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

/**
 * Case-insensitive find, else revive, else insert.
 *
 * Removing a record only hides it, so a name that was removed and later typed
 * again used to make a second row: the catalogue showed one and the stock
 * reports — which do not filter on is_active — counted both. Bringing the hidden
 * row back keeps one row per name instead of accumulating namesakes.
 */
export async function findOrCreateCatalogue(
  client: PoolClient,
  kind: CatalogueKind,
  name: string,
): Promise<number> {
  const table = kind === 'item' ? 'items' : 'products';
  // Active first: if both exist, the visible one is the one being referred to.
  const found = await client.query<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM ${table} WHERE lower(name) = lower($1)
     ORDER BY is_active DESC, id LIMIT 1`,
    [name],
  );
  const hit = found.rows[0];
  if (hit?.is_active) return hit.id;
  if (hit) {
    await client.query(
      `UPDATE ${table} SET is_active = TRUE, updated_at = now() WHERE id = $1`, [hit.id]);
    return hit.id;
  }
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
  const parts = await resolveRawParts(client, itemId, line);
  return { itemId, ...parts };
}

/**
 * The same normalisation against a record the caller already has.
 *
 * Resolving by name is right when the owner typed one, and wrong when the caller
 * knows exactly which row it means: two catalogues can hold the same name, so a
 * name lookup can land on a different record than intended. Converting a record
 * between catalogues hit exactly that — it created the destination row, then
 * looked the name up again and posted the stock to a pre-existing namesake.
 */
export async function resolveRawParts(
  client: PoolClient,
  itemId: number,
  line: Omit<TypedLine, 'name'>,
): Promise<{ unit: string; variantId: number | null }> {
  const unit = (line.size ?? '').trim() || 'pcs';

  await client.query(
    `INSERT INTO item_units (item_id, unit) VALUES ($1,$2) ON CONFLICT (item_id, unit) DO NOTHING`,
    [itemId, unit],
  );

  const design = (line.design ?? '').trim();
  if (!design) return { unit, variantId: null };

  await client.query(
    `INSERT INTO item_variants (item_id, color) VALUES ($1,$2) ON CONFLICT (item_id, color) DO NOTHING`,
    [itemId, design],
  );
  const v = await client.query<{ id: number }>(
    `SELECT id FROM item_variants WHERE item_id = $1 AND color = $2`,
    [itemId, design],
  );
  return { unit, variantId: v.rows[0]?.id ?? null };
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
  const { variantId } = await resolveFinishedParts(client, productId, line);
  return { productId, variantId };
}

/** See resolveRawParts — the finished half, against a known product. */
export async function resolveFinishedParts(
  client: PoolClient,
  productId: number,
  line: Omit<TypedLine, 'name'>,
): Promise<{ variantId: number | null }> {
  const size = (line.size ?? '').trim();
  const design = (line.design ?? '').trim();
  if (!size && !design) return { variantId: null };

  const label = [size, design].filter(Boolean).join(' · ');
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM product_variants
     WHERE product_id = $1
       AND COALESCE(size,'') = $2
       AND COALESCE(design,'') = $3
     LIMIT 1`,
    [productId, size, design],
  );
  if (existing.rows[0]) return { variantId: existing.rows[0].id };

  const made = await client.query<{ id: number }>(
    `INSERT INTO product_variants (product_id, variant, size, design)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (product_id, COALESCE(size, ''), COALESCE(design, ''))
     DO UPDATE SET variant = EXCLUDED.variant
     RETURNING id`,
    [productId, label, size || null, design || null],
  );
  return { variantId: made.rows[0]!.id };
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
