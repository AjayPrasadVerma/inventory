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

/**
 * One spelling for one thing.
 *
 * Matching on lower(name) alone let "Ring  Box" and "Ring Box" become two
 * records that read identically on screen, and a non-breaking space — which
 * arrives whenever a name is pasted from a document or a chat — made a third.
 * Every run of whitespace, of any kind, collapses to a single ordinary space.
 *
 * Applied on the way in, so what is stored is already normalised and a plain
 * lower(name) comparison is then enough on the SQL side.
 */
export function normaliseName(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

/** The same, for a size or a design: they are matched without regard to case. */
export function normalisePart(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/gu, ' ').trim();
}

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
  const clean = normaliseName(name);
  // Active first: if both exist, the visible one is the one being referred to.
  const found = await client.query<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM ${table}
     WHERE lower(regexp_replace(name, '[[:space:]]+', ' ', 'g')) = lower($1)
     ORDER BY is_active DESC, id LIMIT 1`,
    [clean],
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
    [clean],
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
  const typed = normalisePart(line.size) || 'pcs';
  // Case is not part of what a unit or a colour IS. Matching it exactly split one
  // bucket into several — "meter", "Meter" and "METER" each held their own
  // stock — and the sheet's own dropdowns made it easy, offering every spelling
  // the shop had ever used. The first spelling recorded is the one kept.
  const known = await client.query<{ unit: string }>(
    `SELECT unit FROM item_units WHERE item_id = $1 AND lower(unit) = lower($2) LIMIT 1`,
    [itemId, typed],
  );
  const unit = known.rows[0]?.unit ?? typed;
  if (!known.rowCount) {
    await client.query(
      `INSERT INTO item_units (item_id, unit) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [itemId, unit],
    );
  }

  const design = normalisePart(line.design);
  if (!design) return { unit, variantId: null };

  const v = await client.query<{ id: number }>(
    `SELECT id FROM item_variants WHERE item_id = $1 AND lower(color) = lower($2) LIMIT 1`,
    [itemId, design],
  );
  if (v.rows[0]) return { unit, variantId: v.rows[0].id };

  const made = await client.query<{ id: number }>(
    `INSERT INTO item_variants (item_id, color) VALUES ($1,$2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [itemId, design],
  );
  if (made.rows[0]) return { unit, variantId: made.rows[0].id };
  // Lost a race: the row now exists under someone else's spelling.
  const again = await client.query<{ id: number }>(
    `SELECT id FROM item_variants WHERE item_id = $1 AND lower(color) = lower($2) LIMIT 1`,
    [itemId, design],
  );
  return { unit, variantId: again.rows[0]?.id ?? null };
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
  const size = normalisePart(line.size);
  const design = normalisePart(line.design);
  if (!size && !design) return { variantId: null };

  const label = [size, design].filter(Boolean).join(' · ');
  // Case-insensitive for the same reason as a unit or a colour — see
  // resolveRawParts. The spelling already on record wins.
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM product_variants
     WHERE product_id = $1
       AND lower(COALESCE(size,'')) = lower($2)
       AND lower(COALESCE(design,'')) = lower($3)
     LIMIT 1`,
    [productId, size, design],
  );
  if (existing.rows[0]) return { variantId: existing.rows[0].id };

  // The conflict target has to name the index exactly, and 012 folded case into
  // it. DO NOTHING plus a re-read rather than a target expression: it survives
  // the next change to the key, and losing the race is the only way to get here.
  const made = await client.query<{ id: number }>(
    `INSERT INTO product_variants (product_id, variant, size, design)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [productId, label, size || null, design || null],
  );
  if (made.rows[0]) return { variantId: made.rows[0].id };

  const again = await client.query<{ id: number }>(
    `SELECT id FROM product_variants
     WHERE product_id = $1
       AND lower(COALESCE(size,'')) = lower($2)
       AND lower(COALESCE(design,'')) = lower($3)
     LIMIT 1`,
    [productId, size, design],
  );
  return { variantId: again.rows[0]?.id ?? null };
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
