import { query, withTransaction } from '../../config/db.js';
import { likeTerm } from '../../utils/sql.js';
import { resolveFinishedLine, resolveRawLine } from '../../utils/catalogue-resolve.js';

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
  /** null for a payment that belongs to no movement — see log(). */
  direction: Direction | null;
  date: string;
  remark: string | null;
  lines: EntryLine[];
  paid: number;
  payments: { id: number; date: string; method: string | null; amount: number }[];
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

    const ids = entries.map((e) => e.id);
    const lines = ids.length === 0 ? [] : (await query<{
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

    // Every rupee paid to this karigar in range, however it was linked. Payments
    // made against the old jobs carry a job_id and lump sums carry nothing, so a
    // query that only followed karigar_entry_id reported a total of zero while the
    // money sat in the table. Anything not attached to an entry is surfaced as its
    // own row below rather than being dropped.
    const payWhere: string[] = [
      `party_type = 'karigar'`, `party_id = $1`, `direction = 'paid'`,
    ];
    const payParams: unknown[] = [karigarId];
    if (opts.from) { payParams.push(opts.from); payWhere.push(`pay_date >= $${payParams.length}`); }
    if (opts.to) { payParams.push(opts.to); payWhere.push(`pay_date <= $${payParams.length}`); }

    const pays = (await query<{
      karigar_entry_id: number | null; id: number; pay_date: string; method: string | null;
      amount: string; ref_note: string | null;
    }>(
      `SELECT karigar_entry_id, id, pay_date, method, amount, ref_note FROM payments
       WHERE ${payWhere.join(' AND ')}
       ORDER BY pay_date, id`,
      payParams,
    )).rows;

    const linesBy = new Map<number, EntryLine[]>();
    for (const l of lines) {
      const list = linesBy.get(l.entry_id) ?? [];
      list.push({ id: l.id, name: l.name, size: l.size, design: l.design, qty: l.qty });
      linesBy.set(l.entry_id, list);
    }
    const idSet = new Set(ids);
    const paysBy = new Map<number, Entry['payments']>();
    const loose: Entry[] = [];
    for (const p of pays) {
      const line = { id: p.id, date: p.pay_date, method: p.method, amount: Number(p.amount) };
      if (p.karigar_entry_id != null && idSet.has(p.karigar_entry_id)) {
        const list = paysBy.get(p.karigar_entry_id) ?? [];
        list.push(line);
        paysBy.set(p.karigar_entry_id, list);
        continue;
      }
      // A payment with no movement of its own: negative id so it can never
      // collide with a real entry, and direction null so the UI leaves both
      // material columns blank.
      loose.push({
        id: -p.id,
        direction: null,
        date: p.pay_date,
        remark: p.ref_note,
        lines: [],
        payments: [line],
        paid: line.amount,
      });
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
        direction: e.direction as Direction | null,
        date: e.entry_date,
        remark: e.remark,
        lines: myLines,
        payments: myPays,
        paid: myPays.reduce((n, p) => n + p.amount, 0),
      });
    }

    // Loose payments join the same chronology, newest first.
    const all = [...out, ...loose].sort((a, b) =>
      a.date === b.date ? b.id - a.id : (a.date < b.date ? 1 : -1));

    return {
      entries: all,
      totals: {
        in: all.filter((e) => e.direction === 'in').length,
        out: all.filter((e) => e.direction === 'out').length,
        paid: all.reduce((n, e) => n + e.paid, 0),
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
       ORDER BY lower(name) LIMIT 500`,
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
