import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/http.js';
import {
  resolveFinishedLine, resolveFinishedParts, resolveRawLine, resolveRawParts,
} from '../../utils/catalogue-resolve.js';

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
             SELECT MIN(pv.size) AS size, MIN(pv.design) AS design,
                    SUM(f.qty)::float8 AS qty, MIN(f.id) AS first_seen
             FROM finished_stock_movements f
             LEFT JOIN product_variants pv ON pv.id = f.variant_id
             WHERE f.product_id = p.id
             GROUP BY f.variant_id
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
      // Size and design are what the owner actually remembers about a box — "21x11",
      // "Line L Red" — so searching only the name made them hunt. units holds the
      // sizes for raw material, variants the designs; for a finished product the
      // variant label is the size and design composed, so both are covered.
      where.push(`(
        c.name ILIKE $${params.length} ESCAPE '\\'
        OR array_to_string(c.units, ' ') ILIKE $${params.length} ESCAPE '\\'
        OR array_to_string(c.variants, ' ') ILIKE $${params.length} ESCAPE '\\'
      )`);
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
 * A row removed from the sheet arrives here as that bucket set to zero, not as a
 * deletion: the size and design stay in the catalogue and every movement stays in
 * the ledger. History is not the owner's to lose by clearing a line.
 */
export interface SheetEdit {
  kind: 'item' | 'product';
  id: number;
  name: string;
  on_date?: string | null;
  lines: { size?: string | null; design?: string | null; qty?: number | null }[];
}

export async function editCatalogueFromSheet(input: SheetEdit): Promise<{ adjusted: number }> {
  return withTransaction((client) => applySheet(client, input));
}

/**
 * The sheet is the whole picture of a record, not a patch: what it shows is what
 * the record should look like afterwards. So a bucket the owner deleted from it
 * is emptied, not ignored — the ✕ used to remove the row on screen and change
 * nothing, and the save still said "Saved".
 *
 * Emptied rather than deleted: the movements that built the bucket are history
 * and stay, so the correction is another movement bringing it to zero.
 */
export async function applySheet(
  client: PoolClient,
  input: SheetEdit,
): Promise<{ adjusted: number }> {
  {
    // The kind has to come from the caller and cannot be worked out from the id:
    // items and products are separate sequences, so one id routinely exists in
    // both. Deriving it by checking one table first looked safer and was worse —
    // it silently renamed whichever record that table happened to hold. It is in
    // the URL rather than the body so it travels with the record being addressed.
    const kind = input.kind;
    const table = kind === 'item' ? 'items' : 'products';

    const name = input.name.trim();
    if (!name) throw new AppError(400, 'Name is required');

    const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [input.id]);
    if (exists.rowCount === 0) throw new AppError(404, 'Not found');

    // A rename must not collide with something already in the same catalogue, or
    // two rows would answer to one name and the sheet could not tell them apart.
    const clash = await client.query(
      `SELECT 1 FROM ${table} WHERE lower(name) = lower($1) AND id <> $2 AND is_active`,
      [name, input.id],
    );
    if (clash.rowCount) throw new AppError(409, `Another ${kind === 'item' ? 'material' : 'product'} is already called "${name}"`);

    await client.query(`UPDATE ${table} SET name = $2, updated_at = now() WHERE id = $1`, [input.id, name]);

    let adjusted = 0;
    for (const line of input.lines) {
      const size = (line.size ?? '').trim();
      const design = (line.design ?? '').trim();
      const qty = line.qty == null ? null : Number(line.qty);
      // Negative is allowed on edit: a record can genuinely be oversold, the list
      // paints it red, and the sheet has to be able to hand back what it showed.

      if (kind === 'item') {
        // Nothing to do for a line that names no size and sets no quantity —
        // creating a 'pcs' unit here added one the owner never typed.
        if (!size && qty == null) continue;
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
        const delta = Number((qty - cur).toFixed(3));
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
               ON CONFLICT (product_id, COALESCE(size, ''), COALESCE(design, ''))
               DO UPDATE SET variant = EXCLUDED.variant
               RETURNING id`,
              [input.id, label, size || null, design || null])).rows[0]!.id;
        }
        if (qty == null) continue;

        const cur = Number((await client.query<{ q: string | null }>(
          `SELECT SUM(qty)::text AS q FROM finished_stock_movements
           WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2`,
          [input.id, variantId])).rows[0]?.q ?? 0);
        const delta = Number((qty - cur).toFixed(3));
        if (delta !== 0) {
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,'adjustment', COALESCE($4, CURRENT_DATE), 'Stock corrected')`,
            [input.id, variantId, delta, input.on_date ?? null]);
          adjusted += 1;
        }
      }
    }

    // Buckets the sheet no longer mentions are emptied. Keyed exactly as the
    // display groups them, so what disappeared on screen is what goes to zero.
    const seen = new Set<string>();
    for (const line of input.lines) {
      const size = (line.size ?? '').trim();
      const design = (line.design ?? '').trim();
      seen.add(`${kind === 'item' ? (size || 'pcs') : size}::${design}`);
    }

    const existing = kind === 'item'
      ? (await client.query<{ size: string; design: string | null; q: string }>(
          `SELECT sm.unit AS size, iv.color AS design, SUM(sm.qty)::text AS q
           FROM stock_movements sm
           LEFT JOIN item_variants iv ON iv.id = sm.variant_id
           WHERE sm.item_id = $1 GROUP BY sm.unit, iv.color`, [input.id])).rows
      : (await client.query<{ size: string | null; design: string | null; q: string }>(
          `SELECT pv.size, pv.design, SUM(f.qty)::text AS q
           FROM finished_stock_movements f
           LEFT JOIN product_variants pv ON pv.id = f.variant_id
           WHERE f.product_id = $1 GROUP BY pv.size, pv.design`, [input.id])).rows;

    for (const b of existing) {
      const size = (b.size ?? '').trim();
      const design = (b.design ?? '').trim();
      if (seen.has(`${size}::${design}`)) continue;
      const cur = Number(b.q ?? 0);
      if (cur === 0) continue;

      if (kind === 'item') {
        const { unit, variantId } = await resolveRawParts(client, input.id, { size, design });
        await client.query(
          `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, moved_on, note)
           VALUES ($1,$2,$3,$4,'adjustment', COALESCE($5, CURRENT_DATE), 'Removed from the sheet')`,
          [input.id, variantId, unit, -cur, input.on_date ?? null]);
      } else {
        const { variantId } = await resolveFinishedParts(client, input.id, { size, design });
        await client.query(
          `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, moved_on, note)
           VALUES ($1,$2,$3,'adjustment', COALESCE($4, CURRENT_DATE), 'Removed from the sheet')`,
          [input.id, variantId, -cur, input.on_date ?? null]);
      }
      adjusted += 1;
    }

    return { adjusted };
  }
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
  /**
   * The rest of the edit, applied to the moved record in this same transaction.
   *
   * It used to be a second HTTP call. When that call failed — most often because
   * the name already existed in the destination catalogue, which is exactly why
   * someone changes a type — the conversion had already committed: the old record
   * and its stock were gone, and the screen showed an error over a list that still
   * said the record was there. There was no way forward from that dialog.
   */
  sheet?: { name: string; lines: SheetEdit['lines'] } | null;
}): Promise<{ id: number; kind: 'item' | 'product' }> {
  return withTransaction(async (client) => {
    // See editCatalogueFromSheet: the id alone does not say which catalogue, so
    // this comes from the URL and the lookup below is what rejects a wrong one.
    const from = input.from;
    const toKind = from === 'item' ? 'product' : 'item';
    const fromTable = from === 'item' ? 'items' : 'products';

    const rec = await client.query<{ name: string; category: string | null; low_stock_qty: string | null; notes: string | null }>(
      `SELECT name, category, low_stock_qty, notes FROM ${fromTable} WHERE id = $1`, [input.id]);
    if (rec.rowCount === 0) throw new AppError(404, 'Not found');
    const r = rec.rows[0]!;

    // Anything that points at this record by id and is not its own stock.
    const idCol = from === 'item' ? 'item_id' : 'product_id';
    const users: [string, string][] = from === 'item'
      ? [['karigar_entry_lines', 'karigar_entry_lines'], ['purchase_items', 'purchase_items'], ['job_issues', 'job_issues']]
      : [['karigar_entry_lines', 'karigar_entry_lines'], ['purchase_items', 'purchase_items'], ['job_receipts', 'job_receipts'], ['sale_items', 'sale_items']];
    const inUse = async () => {
      for (const [table] of users) {
        const used = await client.query(`SELECT 1 FROM ${table} WHERE ${idCol} = $1 LIMIT 1`, [input.id]);
        if (used.rowCount) return true;
      }
      // Anything that is not an adjustment came from a document, whether or not
      // that document left a line behind — returned material writes a movement
      // and no job_issues row, so a table allowlist alone let it through.
      const moved = from === 'item'
        ? await client.query(
            `SELECT 1 FROM stock_movements WHERE item_id = $1 AND reason <> 'adjustment' LIMIT 1`, [input.id])
        : await client.query(
            `SELECT 1 FROM finished_stock_movements WHERE product_id = $1 AND reason <> 'adjustment' LIMIT 1`, [input.id]);
      return (moved.rowCount ?? 0) > 0;
    };
    if (await inUse()) {
      throw new AppError(409,
        'This is already used in a recorded entry, so its type cannot be changed. Add it under the other type and use that from now on.');
    }

    // The buckets it currently holds, so they can be re-made on the other side.
    const buckets = from === 'item'
      ? (await client.query<{ size: string | null; design: string | null; qty: string }>(
          `SELECT sm.unit AS size, iv.color AS design, SUM(sm.qty)::text AS qty
           FROM stock_movements sm LEFT JOIN item_variants iv ON iv.id = sm.variant_id
           WHERE sm.item_id = $1 GROUP BY sm.unit, iv.color ORDER BY MIN(sm.id)`, [input.id])).rows
      : (await client.query<{ size: string | null; design: string | null; qty: string }>(
          `SELECT pv.size, pv.design, SUM(f.qty)::text AS qty
           FROM finished_stock_movements f LEFT JOIN product_variants pv ON pv.id = f.variant_id
           WHERE f.product_id = $1 GROUP BY pv.size, pv.design ORDER BY MIN(f.id)`, [input.id])).rows;

    const toTable = toKind === 'item' ? 'items' : 'products';

    // Without this the convert created a second row under the same name, and the
    // stock then resolved onto whichever one the lookup happened to return —
    // merging it into an unrelated record and leaving an empty duplicate behind.
    const taken = await client.query(
      `SELECT 1 FROM ${toTable} WHERE lower(name) = lower($1) AND is_active LIMIT 1`, [r.name]);
    if (taken.rowCount) {
      throw new AppError(409,
        `A ${toKind === 'item' ? 'raw material' : 'finished product'} called "${r.name}" already exists. Rename one of them first.`);
    }

    const made = await client.query<{ id: number }>(
      `INSERT INTO ${toTable} (name, category, low_stock_qty, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [r.name, r.category, r.low_stock_qty, r.notes]);
    const newId = made.rows[0]!.id;

    for (const b of buckets) {
      const qty = Number(b.qty);
      const size = (b.size ?? '').trim();
      const design = (b.design ?? '').trim();
      if (toKind === 'item') {
        const { unit, variantId } = await resolveRawParts(client, newId, { size, design });
        if (qty !== 0) {
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,$4,'adjustment', COALESCE($5, CURRENT_DATE), 'Type changed')`,
            [newId, variantId, unit, qty, input.on_date ?? null]);
        }
      } else {
        const { variantId } = await resolveFinishedParts(client, newId, { size, design });
        if (qty !== 0) {
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, moved_on, note)
             VALUES ($1,$2,$3,'adjustment', COALESCE($4, CURRENT_DATE), 'Type changed')`,
            [newId, variantId, qty, input.on_date ?? null]);
        }
      }
    }

    // The old record and its stock go, now that both are re-made on the other
    // side — leaving them would double the shop's count of the same things.
    if (from === 'item') {
      await client.query(`DELETE FROM stock_movements WHERE item_id = $1`, [input.id]);
      await client.query(`DELETE FROM item_units WHERE item_id = $1`, [input.id]);
      await client.query(`DELETE FROM item_variants WHERE item_id = $1`, [input.id]);
    } else {
      await client.query(`DELETE FROM finished_stock_movements WHERE product_id = $1`, [input.id]);
      await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [input.id]);
    }
    await client.query(`DELETE FROM ${fromTable} WHERE id = $1`, [input.id]);

    // Same transaction: a rename that clashes rolls the move back with it, so the
    // owner is returned to exactly what they had rather than to a half-done state.
    if (input.sheet) {
      await applySheet(client, {
        kind: toKind,
        id: newId,
        name: input.sheet.name,
        on_date: input.on_date ?? null,
        lines: input.sheet.lines,
      });
    }

    return { id: newId, kind: toKind };
  });
}
