import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../config/db.js';
import { likeTerm } from '../../utils/sql.js';

/**
 * Karigar material movement as an ordered log.
 *
 * A job used to pair an issue with a receipt, which meant goods could not be
 * recorded coming IN unless material had already gone OUT against that job. The
 * shop does not work that way: the owner records what happened, in the order it
 * happened. So an entry is one direction, one date, one remark, and a set of
 * lines — and IN and OUT are independent.
 *
 * A line names its thing by TEXT, not by id. The owner types "Ring Box" and picks
 * from suggestions if it exists; if it does not, it is created here rather than
 * on a separate screen. Size and design are typed the same way, and the unit
 * lives in size ("meter", "2x3") because that is how the owner reads it.
 *
 * Those free-text values are normalised into the existing catalogue tables on
 * write — item_units / item_variants for raw, product_variants for finished.
 * Every stock query, report and dashboard counter is keyed on those tables, so
 * normalising here is what keeps all of them working untouched.
 */

export type Direction = 'in' | 'out';

export interface EntryLineInput {
  /** Catalogue name as typed. Resolved to an existing row, or created. */
  name: string;
  size?: string | null;
  design?: string | null;
  qty: number;
}

export interface EntryInput {
  karigar_id: number;
  direction: Direction;
  entry_date?: string | null;
  remark?: string | null;
  lines: EntryLineInput[];
  advance?: { amount: number; method?: string | null } | null;
  created_by?: number | null;
}

export interface EntryLine {
  id: number;
  name: string;
  size: string | null;
  design: string | null;
  qty: string;
}

export interface Entry {
  id: number;
  direction: Direction;
  date: string;
  remark: string | null;
  lines: EntryLine[];
  paid: number;
  payments: { id: number; date: string; method: string | null; amount: number }[];
}

/** Case-insensitive find, else insert. Returns the catalogue row's id. */
async function findOrCreateCatalogue(
  client: PoolClient,
  direction: Direction,
  name: string,
): Promise<number> {
  const table = direction === 'out' ? 'items' : 'products';
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
 * Resolve one raw-material line: the item, the unit it is counted in, and the
 * colour. Size carries the unit, design carries the colour — which is exactly
 * the shape items already had, so nothing about raw stock needs to change.
 */
async function resolveRawLine(
  client: PoolClient,
  line: EntryLineInput,
): Promise<{ itemId: number; unit: string; variantId: number | null }> {
  const itemId = await findOrCreateCatalogue(client, 'out', line.name);
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
 * Resolve one finished-goods line. product_variants held size and design jammed
 * into a single `variant` text field; migration 010 split them out and keeps
 * `variant` as the composed display label so older readers still work.
 */
async function resolveFinishedLine(
  client: PoolClient,
  line: EntryLineInput,
): Promise<{ productId: number; variantId: number | null }> {
  const productId = await findOrCreateCatalogue(client, 'in', line.name);
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

export const karigarEntriesRepo = {
  /** One entry, its lines, the stock they move, and any advance paid with it. */
  async create(input: EntryInput): Promise<{ id: number }> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark, created_by)
         VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING id`,
        [
          input.karigar_id,
          input.direction,
          input.entry_date ?? null,
          input.remark ?? null,
          input.created_by ?? null,
        ],
      );
      const entryId = rows[0]!.id;
      const onDate = input.entry_date ?? null;

      for (const line of input.lines) {
        if (input.direction === 'out') {
          const { itemId, unit, variantId } = await resolveRawLine(client, line);
          await client.query(
            `INSERT INTO karigar_entry_lines (entry_id, item_id, size, design, qty)
             VALUES ($1,$2,$3,$4,$5)`,
            [entryId, itemId, line.size ?? null, line.design ?? null, line.qty],
          );
          // Material leaving the shop is a negative raw movement.
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, moved_on)
             VALUES ($1,$2,$3,$4,'karigar_out',$5, COALESCE($6, CURRENT_DATE))`,
            [itemId, variantId, unit, -Math.abs(line.qty), entryId, onDate],
          );
        } else {
          const { productId, variantId } = await resolveFinishedLine(client, line);
          await client.query(
            `INSERT INTO karigar_entry_lines (entry_id, product_id, size, design, qty)
             VALUES ($1,$2,$3,$4,$5)`,
            [entryId, productId, line.size ?? null, line.design ?? null, line.qty],
          );
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
             VALUES ($1,$2,$3,'karigar_in',$4, COALESCE($5, CURRENT_DATE))`,
            [productId, variantId, Math.abs(line.qty), entryId, onDate],
          );
        }
      }

      if (input.advance && input.advance.amount > 0) {
        await client.query(
          `INSERT INTO payments
             (party_type, party_id, direction, amount, method, pay_date, ref_note, karigar_entry_id)
           VALUES ('karigar', $1, 'paid', $2, COALESCE($3,'cash'), COALESCE($4, CURRENT_DATE), $5, $6)`,
          [
            input.karigar_id,
            input.advance.amount,
            input.advance.method ?? null,
            onDate,
            input.remark ?? null,
            entryId,
          ],
        );
      }

      return { id: entryId };
    });
  },

  /**
   * The log for one karigar, newest first. Ordered by date then id, so two
   * entries on the same day keep the order they were recorded in.
   */
  async log(
    karigarId: number,
    opts: { from?: string | null; to?: string | null; search?: string | null } = {},
  ): Promise<{ entries: Entry[]; totals: { in: number; out: number; paid: number } }> {
    const where: string[] = ['e.karigar_id = $1'];
    const params: unknown[] = [karigarId];
    if (opts.from) { params.push(opts.from); where.push(`e.entry_date >= $${params.length}`); }
    if (opts.to) { params.push(opts.to); where.push(`e.entry_date <= $${params.length}`); }

    const entries = (await query<{
      id: number; direction: Direction; entry_date: string; remark: string | null;
    }>(
      `SELECT id, direction, entry_date, remark
       FROM karigar_entries e
       WHERE ${where.join(' AND ')}
       ORDER BY e.entry_date DESC, e.id DESC`,
      params,
    )).rows;

    if (entries.length === 0) {
      return { entries: [], totals: { in: 0, out: 0, paid: 0 } };
    }

    const ids = entries.map((e) => e.id);
    const lines = (await query<{
      entry_id: number; id: number; name: string; size: string | null; design: string | null; qty: string;
    }>(
      `SELECT l.entry_id, l.id, COALESCE(i.name, p.name) AS name, l.size, l.design, l.qty
       FROM karigar_entry_lines l
       LEFT JOIN items i ON i.id = l.item_id
       LEFT JOIN products p ON p.id = l.product_id
       WHERE l.entry_id = ANY($1::int[])
       ORDER BY l.id`,
      [ids],
    )).rows;

    const pays = (await query<{
      karigar_entry_id: number; id: number; pay_date: string; method: string | null; amount: string;
    }>(
      `SELECT karigar_entry_id, id, pay_date, method, amount FROM payments
       WHERE party_type = 'karigar' AND party_id = $1 AND direction = 'paid'
         AND karigar_entry_id = ANY($2::int[])
       ORDER BY pay_date, id`,
      [karigarId, ids],
    )).rows;

    const linesBy = new Map<number, EntryLine[]>();
    for (const l of lines) {
      const list = linesBy.get(l.entry_id) ?? [];
      list.push({ id: l.id, name: l.name, size: l.size, design: l.design, qty: l.qty });
      linesBy.set(l.entry_id, list);
    }
    const paysBy = new Map<number, Entry['payments']>();
    for (const p of pays) {
      const list = paysBy.get(p.karigar_entry_id) ?? [];
      list.push({ id: p.id, date: p.pay_date, method: p.method, amount: Number(p.amount) });
      paysBy.set(p.karigar_entry_id, list);
    }

    // Search filters on what is visible — the remark or any line's name, size or
    // design — rather than on a column the owner cannot see.
    const term = (opts.search ?? '').trim().toLowerCase();
    const out: Entry[] = [];
    for (const e of entries) {
      const myLines = linesBy.get(e.id) ?? [];
      if (term) {
        const hay = [e.remark ?? '', ...myLines.flatMap((l) => [l.name, l.size ?? '', l.design ?? ''])]
          .join(' ').toLowerCase();
        if (!hay.includes(term)) continue;
      }
      const myPays = paysBy.get(e.id) ?? [];
      out.push({
        id: e.id,
        direction: e.direction,
        date: e.entry_date,
        remark: e.remark,
        lines: myLines,
        payments: myPays,
        paid: myPays.reduce((n, p) => n + p.amount, 0),
      });
    }

    return {
      entries: out,
      totals: {
        in: out.filter((e) => e.direction === 'in').length,
        out: out.filter((e) => e.direction === 'out').length,
        paid: out.reduce((n, e) => n + e.paid, 0),
      },
    };
  },

  /**
   * Remove an entry. The stock it moved goes with it, and so does the advance —
   * leaving the payment behind would strand money against a document that no
   * longer exists, which is the bug 009 was written to make impossible.
   */
  async remove(karigarId: number, entryId: number): Promise<boolean> {
    return withTransaction(async (client) => {
      const owned = await client.query(
        `SELECT 1 FROM karigar_entries WHERE id = $1 AND karigar_id = $2`,
        [entryId, karigarId],
      );
      if (owned.rowCount === 0) return false;

      await client.query(
        `DELETE FROM payments
         WHERE party_type = 'karigar' AND party_id = $1 AND karigar_entry_id = $2`,
        [karigarId, entryId],
      );
      await client.query(
        `DELETE FROM stock_movements WHERE reason = 'karigar_out' AND ref_id = $1`,
        [entryId],
      );
      await client.query(
        `DELETE FROM finished_stock_movements WHERE reason = 'karigar_in' AND ref_id = $1`,
        [entryId],
      );
      // Lines cascade.
      await client.query(`DELETE FROM karigar_entries WHERE id = $1`, [entryId]);
      return true;
    });
  },

  /**
   * What to offer in the form's Item box, and the size / design values already
   * used for a picked name. Direction decides which catalogue is searched, so an
   * OUT form never suggests a finished box.
   */
  async suggest(direction: Direction, q: string): Promise<{ name: string; sizes: string[]; designs: string[] }[]> {
    const table = direction === 'out' ? 'items' : 'products';
    const term = likeTerm(q);
    const names = (await query<{ id: number; name: string }>(
      `SELECT id, name FROM ${table}
       WHERE is_active AND name ILIKE '%' || $1 || '%' ESCAPE '\\'
       ORDER BY lower(name) LIMIT 20`,
      [term],
    )).rows;
    if (names.length === 0) return [];

    const ids = names.map((n) => n.id);
    const sizeRows = direction === 'out'
      ? (await query<{ id: number; v: string }>(
          `SELECT item_id AS id, unit AS v FROM item_units WHERE item_id = ANY($1::int[])`, [ids])).rows
      : (await query<{ id: number; v: string }>(
          `SELECT product_id AS id, size AS v FROM product_variants
           WHERE product_id = ANY($1::int[]) AND size IS NOT NULL`, [ids])).rows;
    const designRows = direction === 'out'
      ? (await query<{ id: number; v: string }>(
          `SELECT item_id AS id, color AS v FROM item_variants WHERE item_id = ANY($1::int[])`, [ids])).rows
      : (await query<{ id: number; v: string }>(
          `SELECT product_id AS id, design AS v FROM product_variants
           WHERE product_id = ANY($1::int[]) AND design IS NOT NULL`, [ids])).rows;

    const group = (rows: { id: number; v: string }[]) => {
      const m = new Map<number, Set<string>>();
      for (const r of rows) {
        if (!r.v) continue;
        const s = m.get(r.id) ?? new Set<string>();
        s.add(r.v);
        m.set(r.id, s);
      }
      return m;
    };
    const sizesBy = group(sizeRows);
    const designsBy = group(designRows);

    return names.map((n) => ({
      name: n.name,
      sizes: [...(sizesBy.get(n.id) ?? [])].sort(),
      designs: [...(designsBy.get(n.id) ?? [])].sort(),
    }));
  },
};
