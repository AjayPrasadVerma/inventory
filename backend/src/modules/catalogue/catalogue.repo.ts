import { query, withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/http.js';
import { resolveFinishedLine, resolveRawLine } from '../../utils/catalogue-resolve.js';

/**
 * One catalogue, two kinds of thing.
 *
 * The owner thinks of everything on the shelf as stock — "dono to product hua na,
 * chahe raw ho ya finished" — so the UI shows one list. Underneath they stay
 * separate entities on purpose: a karigar is ISSUED raw material and RETURNS
 * finished goods, and their stock lives in different tables. Merge the rows and
 * "kitna diya vs kitna maal aaya" stops being expressible.
 *
 * So this reads both catalogues into one shape and lets the UI present them
 * together, without either side losing what makes it different: raw materials
 * have units and colours, finished products have variants and are counted in
 * pieces.
 */
export type CatalogueKind = 'item' | 'product';

export interface CatalogueRow {
  kind: CatalogueKind;
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  /** Raw materials only — products have no unit catalogue. */
  units: string[];
  /** Colours for a raw material, composed labels for a product. */
  variants: string[];
  /**
   * The buckets stock is actually held in, with what is in each. Raw material is
   * keyed on (unit, colour) and finished goods on their variant, so these are
   * the real rows — not the cross product of the catalogue's axes, and not a
   * single total. The edit sheet corrects against these, so a number that did
   * not match its bucket would book a phantom adjustment.
   */
  variant_rows: { size: string | null; design: string | null; qty: number }[];
  /** Per unit for a raw material; a single "pcs" line for a product. */
  on_hand: { unit: string; qty: number }[];
}

const ITEM_SIDE = `
  SELECT 'item'::text AS kind, i.id, i.name, i.category, i.low_stock_qty, i.notes,
         COALESCE((SELECT array_agg(u.unit ORDER BY u.id) FROM item_units u WHERE u.item_id = i.id), '{}') AS units,
         COALESCE((SELECT array_agg(v.color ORDER BY v.color) FROM item_variants v WHERE v.item_id = i.id), '{}') AS variants,
         COALESCE((
           SELECT json_agg(json_build_object('size', x.unit, 'design', x.color, 'qty', x.qty)
                           ORDER BY x.first_seen)
           FROM (
             SELECT sm.unit, iv.color, SUM(sm.qty)::float8 AS qty, MIN(sm.id) AS first_seen
             FROM stock_movements sm
             LEFT JOIN item_variants iv ON iv.id = sm.variant_id
             WHERE sm.item_id = i.id
             GROUP BY sm.unit, iv.color
           ) x
         ), '[]'::json) AS variant_rows,
         COALESCE((
           SELECT json_agg(json_build_object('unit', x.unit, 'qty', x.qty) ORDER BY x.unit)
           FROM (
             SELECT sm.unit, SUM(sm.qty)::float8 AS qty
             FROM stock_movements sm WHERE sm.item_id = i.id
             GROUP BY sm.unit HAVING SUM(sm.qty) <> 0
           ) x
         ), '[]'::json) AS on_hand
  FROM items i WHERE i.is_active`;

const PRODUCT_SIDE = `
  SELECT 'product'::text AS kind, p.id, p.name, p.category, p.low_stock_qty, p.notes,
         '{}'::text[] AS units,
         COALESCE((SELECT array_agg(pv.variant ORDER BY pv.variant) FROM product_variants pv WHERE pv.product_id = p.id), '{}') AS variants,
         COALESCE((
           SELECT json_agg(json_build_object('size', x.size, 'design', x.design, 'qty', x.qty)
                           ORDER BY x.first_seen)
           FROM (
             SELECT pv.size, pv.design, SUM(f.qty)::float8 AS qty, MIN(f.id) AS first_seen
             FROM finished_stock_movements f
             LEFT JOIN product_variants pv ON pv.id = f.variant_id
             WHERE f.product_id = p.id
             GROUP BY pv.size, pv.design
           ) x
         ), '[]'::json) AS variant_rows,
         json_build_array(json_build_object(
           'unit', 'pcs',
           'qty', COALESCE((SELECT SUM(f.qty)::float8 FROM finished_stock_movements f WHERE f.product_id = p.id), 0)
         )) AS on_hand
  FROM products p WHERE p.is_active`;

const SORTABLE: Record<string, string> = { name: 'name', category: 'category', kind: 'kind' };

export const catalogueRepo = {
  async list(opts: {
    search?: string;
    category?: string;
    kind?: CatalogueKind;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit: number;
    offset: number;
  }): Promise<{ rows: CatalogueRow[]; total: number }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (opts.search) {
      // % and _ are LIKE wildcards: unescaped, a search for "%" returns everything
      // and no index can be used.
      params.push(`%${opts.search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`c.name ILIKE $${params.length} ESCAPE '\\'`);
    }
    if (opts.category) {
      params.push(opts.category);
      where.push(`c.category = $${params.length}`);
    }
    if (opts.kind) {
      params.push(opts.kind);
      where.push(`c.kind = $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const sortCol = SORTABLE[opts.sort ?? 'name'] ?? 'name';
    const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
    const both = `(${ITEM_SIDE} UNION ALL ${PRODUCT_SIDE}) c`;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM ${both} ${whereSql}`,
      params,
    );
    const rowsRes = await query<CatalogueRow>(
      `SELECT * FROM ${both} ${whereSql}
       ORDER BY c.${sortCol} ${dir}, c.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  /** Categories across both catalogues, for the filter dropdown. */
  async categories(): Promise<string[]> {
    const { rows } = await query<{ category: string }>(
      `SELECT DISTINCT category FROM (
         SELECT category FROM items WHERE is_active AND category IS NOT NULL AND category <> ''
         UNION SELECT category FROM products WHERE is_active AND category IS NOT NULL AND category <> ''
       ) t ORDER BY category`,
    );
    return rows.map((r) => r.category);
  },
};

/**
 * Add catalogue rows the way movement is recorded: a sheet of typed lines.
 *
 * The owner does not think of "create the product, then set its opening stock" as
 * two acts — a thing exists because there is some of it on the shelf. So one line
 * both creates the catalogue row and books what is already there, and the same
 * resolver used by the karigar and purchase sheets does the creating, which is
 * what keeps units, colours, sizes and designs landing in the same tables every
 * other screen reads.
 *
 * A line with no quantity still creates the row — sometimes a thing is stocked
 * before any of it is in hand.
 */
export async function addCatalogueLines(input: {
  kind: 'item' | 'product';
  on_date?: string | null;
  lines: { name: string; size?: string | null; design?: string | null; qty?: number | null }[];
  created_by?: number | null;
}): Promise<{ created: number; stocked: number }> {
  return withTransaction(async (client) => {
    let stocked = 0;
    for (const line of input.lines) {
      const qty = Number(line.qty ?? 0);
      // The route already rejects a negative, but silently skipping one here
      // would let any other caller create the row and book nothing — the line
      // would look accepted while doing something else entirely.
      if (qty < 0) throw new AppError(400, `Quantity for "${line.name}" cannot be negative`);
      if (input.kind === 'item') {
        const { itemId, unit, variantId } = await resolveRawLine(client, line);
        if (qty > 0) {
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,$4,'adjustment', COALESCE($5, CURRENT_DATE), 'Opening stock')`,
            [itemId, variantId, unit, qty, input.on_date ?? null],
          );
          stocked += 1;
        }
      } else {
        const { productId, variantId } = await resolveFinishedLine(client, line);
        if (qty > 0) {
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,'adjustment', COALESCE($4, CURRENT_DATE), 'Opening stock')`,
            [productId, variantId, qty, input.on_date ?? null],
          );
          stocked += 1;
        }
      }
    }
    return { created: input.lines.length, stocked };
  });
}

/**
 * Edit one catalogue record from the same sheet it was added with.
 *
 * The owner asked for one gesture, so editing is the add sheet prefilled. That
 * makes the quantity column mean something different here: it arrives showing
 * what is on hand, so changing it reads as "make the stock this", and the
 * difference is booked as one adjustment. Re-adding the number outright would
 * double the stock every time the form was opened and saved.
 *
 * A variant that disappears from the sheet is dropped from the catalogue, but its
 * movements are left alone — history is not the owner's to lose by editing a row.
 */
export async function editCatalogueFromSheet(input: {
  kind: 'item' | 'product';
  id: number;
  name: string;
  on_date?: string | null;
  lines: { size?: string | null; design?: string | null; qty?: number | null }[];
}): Promise<{ adjusted: number }> {
  return withTransaction(async (client) => {
    const table = input.kind === 'item' ? 'items' : 'products';
    const name = input.name.trim();
    if (!name) throw new AppError(400, 'Name is required');

    const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [input.id]);
    if (exists.rowCount === 0) throw new AppError(404, 'Not found');

    // A rename must not collide with something already in the same catalogue, or
    // two rows would answer to one name and the sheet could not tell them apart.
    const clash = await client.query(
      `SELECT 1 FROM ${table} WHERE lower(name) = lower($1) AND id <> $2`,
      [name, input.id],
    );
    if (clash.rowCount) throw new AppError(409, `Another ${input.kind === 'item' ? 'material' : 'product'} is already called "${name}"`);

    await client.query(`UPDATE ${table} SET name = $2, updated_at = now() WHERE id = $1`, [input.id, name]);

    let adjusted = 0;
    for (const line of input.lines) {
      const size = (line.size ?? '').trim();
      const design = (line.design ?? '').trim();
      const qty = line.qty == null ? null : Number(line.qty);
      if (qty != null && qty < 0) throw new AppError(400, 'Quantity cannot be negative');

      if (input.kind === 'item') {
        const unit = size || 'pcs';
        await client.query(
          `INSERT INTO item_units (item_id, unit) VALUES ($1,$2) ON CONFLICT (item_id, unit) DO NOTHING`,
          [input.id, unit]);
        let variantId: number | null = null;
        if (design) {
          await client.query(
            `INSERT INTO item_variants (item_id, color) VALUES ($1,$2) ON CONFLICT (item_id, color) DO NOTHING`,
            [input.id, design]);
          variantId = (await client.query<{ id: number }>(
            `SELECT id FROM item_variants WHERE item_id = $1 AND color = $2`, [input.id, design])).rows[0]?.id ?? null;
        }
        if (qty == null) continue;

        const cur = Number((await client.query<{ q: string | null }>(
          `SELECT SUM(qty)::text AS q FROM stock_movements
           WHERE item_id = $1 AND unit = $2 AND variant_id IS NOT DISTINCT FROM $3`,
          [input.id, unit, variantId])).rows[0]?.q ?? 0);
        const delta = qty - cur;
        if (delta !== 0) {
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,$4,'adjustment', COALESCE($5, CURRENT_DATE), 'Stock corrected')`,
            [input.id, variantId, unit, delta, input.on_date ?? null]);
          adjusted += 1;
        }
      } else {
        let variantId: number | null = null;
        if (size || design) {
          const label = [size, design].filter(Boolean).join(' · ');
          const found = await client.query<{ id: number }>(
            `SELECT id FROM product_variants
             WHERE product_id = $1 AND COALESCE(size,'') = $2 AND COALESCE(design,'') = $3 LIMIT 1`,
            [input.id, size, design]);
          variantId = found.rows[0]?.id
            ?? (await client.query<{ id: number }>(
              `INSERT INTO product_variants (product_id, variant, size, design) VALUES ($1,$2,$3,$4)
               ON CONFLICT (product_id, variant) DO UPDATE SET size = EXCLUDED.size, design = EXCLUDED.design
               RETURNING id`,
              [input.id, label, size || null, design || null])).rows[0]!.id;
        }
        if (qty == null) continue;

        const cur = Number((await client.query<{ q: string | null }>(
          `SELECT SUM(qty)::text AS q FROM finished_stock_movements
           WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2`,
          [input.id, variantId])).rows[0]?.q ?? 0);
        const delta = qty - cur;
        if (delta !== 0) {
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,'adjustment', COALESCE($4, CURRENT_DATE), 'Stock corrected')`,
            [input.id, variantId, delta, input.on_date ?? null]);
          adjusted += 1;
        }
      }
    }

    return { adjusted };
  });
}

/**
 * Move a record between the two catalogues.
 *
 * Type was locked because the stock history lives with the record, and that is
 * still true — a raw material and a finished product keep their stock in
 * different tables, so changing the type is a migration, not a field edit. But
 * getting it wrong at creation is easy and the alternative was retyping the whole
 * thing, so it is allowed when it can be done without losing anything.
 *
 * It cannot when a document already refers to the record: a karigar entry line, a
 * purchase line, an old job issue or receipt, or a sale. Those point at one table
 * by id, and moving the record out from under them would strand the line — the
 * quantity would still be in the ledger with nothing on the other end. That is
 * refused with the reason rather than half-done.
 *
 * Size carries the unit either way, which is what makes the two shapes line up:
 * a raw bucket of (unit, colour) becomes a variant of (size, design), and back.
 */
export async function convertCatalogueKind(input: {
  from: 'item' | 'product';
  id: number;
  on_date?: string | null;
}): Promise<{ id: number; kind: 'item' | 'product' }> {
  return withTransaction(async (client) => {
    const toKind = input.from === 'item' ? 'product' : 'item';
    const fromTable = input.from === 'item' ? 'items' : 'products';

    const rec = await client.query<{ name: string; category: string | null; low_stock_qty: string | null; notes: string | null }>(
      `SELECT name, category, low_stock_qty, notes FROM ${fromTable} WHERE id = $1`, [input.id]);
    if (rec.rowCount === 0) throw new AppError(404, 'Not found');
    const r = rec.rows[0]!;

    // Anything that points at this record by id and is not its own stock.
    const idCol = input.from === 'item' ? 'item_id' : 'product_id';
    const users: [string, string][] = input.from === 'item'
      ? [['karigar_entry_lines', 'karigar_entry_lines'], ['purchase_items', 'purchase_items'], ['job_issues', 'job_issues']]
      : [['karigar_entry_lines', 'karigar_entry_lines'], ['purchase_items', 'purchase_items'], ['job_receipts', 'job_receipts'], ['sale_items', 'sale_items']];
    for (const [table] of users) {
      const used = await client.query(`SELECT 1 FROM ${table} WHERE ${idCol} = $1 LIMIT 1`, [input.id]);
      if (used.rowCount) {
        throw new AppError(409,
          'This is already used in a recorded entry, so its type cannot be changed. Add it under the other type and use that from now on.');
      }
    }

    // The buckets it currently holds, so they can be re-made on the other side.
    const buckets = input.from === 'item'
      ? (await client.query<{ size: string | null; design: string | null; qty: string }>(
          `SELECT sm.unit AS size, iv.color AS design, SUM(sm.qty)::text AS qty
           FROM stock_movements sm LEFT JOIN item_variants iv ON iv.id = sm.variant_id
           WHERE sm.item_id = $1 GROUP BY sm.unit, iv.color ORDER BY MIN(sm.id)`, [input.id])).rows
      : (await client.query<{ size: string | null; design: string | null; qty: string }>(
          `SELECT pv.size, pv.design, SUM(f.qty)::text AS qty
           FROM finished_stock_movements f LEFT JOIN product_variants pv ON pv.id = f.variant_id
           WHERE f.product_id = $1 GROUP BY pv.size, pv.design ORDER BY MIN(f.id)`, [input.id])).rows;

    const toTable = toKind === 'item' ? 'items' : 'products';
    const made = await client.query<{ id: number }>(
      `INSERT INTO ${toTable} (name, category, low_stock_qty, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [r.name, r.category, r.low_stock_qty, r.notes]);
    const newId = made.rows[0]!.id;

    for (const b of buckets) {
      const qty = Number(b.qty);
      const size = (b.size ?? '').trim();
      const design = (b.design ?? '').trim();
      if (toKind === 'item') {
        const { itemId, unit, variantId } = await resolveRawLine(client, { name: r.name, size, design });
        if (qty !== 0) {
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,$4,'adjustment', COALESCE($5, CURRENT_DATE), 'Type changed')`,
            [itemId, variantId, unit, qty, input.on_date ?? null]);
        }
      } else {
        const { productId, variantId } = await resolveFinishedLine(client, { name: r.name, size, design });
        if (qty !== 0) {
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,'adjustment', COALESCE($4, CURRENT_DATE), 'Type changed')`,
            [productId, variantId, qty, input.on_date ?? null]);
        }
      }
    }

    // The old record and its stock go, now that both are re-made on the other
    // side — leaving them would double the shop's count of the same things.
    if (input.from === 'item') {
      await client.query(`DELETE FROM stock_movements WHERE item_id = $1`, [input.id]);
      await client.query(`DELETE FROM item_units WHERE item_id = $1`, [input.id]);
      await client.query(`DELETE FROM item_variants WHERE item_id = $1`, [input.id]);
    } else {
      await client.query(`DELETE FROM finished_stock_movements WHERE product_id = $1`, [input.id]);
      await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [input.id]);
    }
    await client.query(`DELETE FROM ${fromTable} WHERE id = $1`, [input.id]);

    return { id: newId, kind: toKind };
  });
}
