import { query, withTransaction } from '../../config/db.js';
import { likeTerm } from '../../utils/sql.js';

export interface ItemRow {
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  units: string[];
  variants: string[];
  variant_options: { id: number; color: string }[];
  on_hand: { unit: string; qty: number }[];
}

export interface ItemInput {
  name: string;
  category?: string | null;
  low_stock_qty?: number | null;
  notes?: string | null;
  units: string[];
  variants: string[];
  /** One-time opening stock at create (onboarding); color=null when the item has no colours. */
  opening?: { color: string | null; unit: string; qty: number }[];
}

const SORTABLE: Record<string, string> = { name: 'name', category: 'category', created_at: 'created_at' };

const SELECT_WITH_CHILDREN = `
  SELECT i.*,
    COALESCE(array_agg(DISTINCT u.unit)  FILTER (WHERE u.unit  IS NOT NULL), '{}') AS units,
    COALESCE(array_agg(DISTINCT v.color) FILTER (WHERE v.color IS NOT NULL), '{}') AS variants,
    COALESCE(
      json_agg(DISTINCT jsonb_build_object('id', v.id, 'color', v.color)) FILTER (WHERE v.id IS NOT NULL),
      '[]'
    ) AS variant_options,
    COALESCE((
      SELECT json_agg(json_build_object('unit', u2.unit, 'qty', u2.qty) ORDER BY u2.unit)
      FROM (
        SELECT sm.unit, SUM(sm.qty)::float8 AS qty
        FROM stock_movements sm WHERE sm.item_id = i.id
        GROUP BY sm.unit HAVING SUM(sm.qty) <> 0
      ) u2
    ), '[]') AS on_hand
  FROM items i
  LEFT JOIN item_units u    ON u.item_id = i.id
  LEFT JOIN item_variants v ON v.item_id = i.id
`;

export const itemsRepo = {
  /** Lightweight picker options: id, name, units, colour variants. No stock aggregates. */
  async options(): Promise<{ id: number; name: string; units: string[]; variant_options: { id: number; color: string }[] }[]> {
    const { rows } = await query<{ id: number; name: string; units: string[]; variant_options: { id: number; color: string }[] }>(
      `SELECT i.id, i.name,
        COALESCE(array_agg(DISTINCT u.unit) FILTER (WHERE u.unit IS NOT NULL), '{}') AS units,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'color', v.color)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variant_options
       FROM items i
       LEFT JOIN item_units u ON u.item_id = i.id
       LEFT JOIN item_variants v ON v.item_id = i.id
       WHERE i.is_active = TRUE
       GROUP BY i.id, i.name
       ORDER BY i.name`,
    );
    return rows;
  },

  async list(opts: {
    search?: string;
    category?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit: number;
    offset: number;
  }): Promise<{ rows: ItemRow[]; total: number }> {
    const where: string[] = ['i.is_active = TRUE'];
    const params: unknown[] = [];

    if (opts.search) {
      params.push(likeTerm(opts.search));
      where.push(`i.name ILIKE $${params.length} ESCAPE '\\'`);
    }
    if (opts.category) {
      params.push(opts.category);
      where.push(`i.category = $${params.length}`);
    }

    const sortCol = SORTABLE[opts.sort ?? 'name'] ?? 'name';
    const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM items i ${whereSql}`,
      params,
    );
    const rowsRes = await query<ItemRow>(
      `${SELECT_WITH_CHILDREN} ${whereSql}
       GROUP BY i.id
       ORDER BY i.${sortCol} ${dir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number): Promise<ItemRow | null> {
    const { rows } = await query<ItemRow>(
      `${SELECT_WITH_CHILDREN} WHERE i.id = $1 GROUP BY i.id`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create(input: ItemInput): Promise<ItemRow> {
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO items (name, category, low_stock_qty, notes)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.name, input.category ?? null, input.low_stock_qty ?? null, input.notes ?? null],
      );
      const newId = rows[0]!.id;
      await replaceChildren(client, newId, input.units, input.variants);

      // One-time opening stock → an 'adjustment' movement per colour+unit (onboarding).
      const opening = (input.opening ?? []).filter((o) => o.qty > 0 && o.unit);
      if (opening.length > 0) {
        const vres = await client.query<{ id: number; color: string }>(
          'SELECT id, color FROM item_variants WHERE item_id = $1',
          [newId],
        );
        const byColor = new Map(vres.rows.map((v) => [v.color.toLowerCase(), v.id]));
        for (const o of opening) {
          const variantId = o.color ? byColor.get(o.color.toLowerCase()) ?? null : null;
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, note)
             VALUES ($1, $2, $3, $4, 'adjustment', 'Opening stock')`,
            [newId, variantId, o.unit, o.qty],
          );
        }
      }
      return newId;
    });
    return (await this.findById(id))!;
  },

  async update(id: number, input: ItemInput): Promise<ItemRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE items SET name=$2, category=$3, low_stock_qty=$4, notes=$5, updated_at=now() WHERE id=$1`,
        [id, input.name, input.category ?? null, input.low_stock_qty ?? null, input.notes ?? null],
      );
      await replaceChildren(client, id, input.units, input.variants);
    });
    return this.findById(id);
  },

  async softDelete(id: number): Promise<boolean> {
    const res = await query('UPDATE items SET is_active=FALSE, updated_at=now() WHERE id=$1', [id]);
    return (res.rowCount ?? 0) > 0;
  },

  async distinctCategories(): Promise<string[]> {
    const { rows } = await query<{ category: string }>(
      `SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category <> '' ORDER BY category`,
    );
    return rows.map((r) => r.category);
  },

  async distinctUnits(): Promise<string[]> {
    const { rows } = await query<{ unit: string }>(`SELECT DISTINCT unit FROM item_units ORDER BY unit`);
    return rows.map((r) => r.unit);
  },

  async stockAccount(id: number): Promise<{
    onHand: { variant: string | null; unit: string; qty: number }[];
    entries: {
      date: string;
      reason: 'purchase' | 'adjustment' | 'job_issue' | 'job_return';
      party: string | null;
      variant: string | null;
      unit: string;
      qty: number;
      note: string | null;
    }[];
  } | null> {
    const ex = await query('SELECT id FROM items WHERE id = $1', [id]);
    if (!ex.rows[0]) return null;

    const onHand = await query<{ variant: string | null; unit: string; qty: number }>(
      `SELECT iv.color AS variant, sm.unit, SUM(sm.qty)::float8 AS qty
       FROM stock_movements sm
       LEFT JOIN item_variants iv ON iv.id = sm.variant_id
       WHERE sm.item_id = $1
       GROUP BY iv.color, sm.unit
       HAVING SUM(sm.qty) <> 0
       ORDER BY iv.color NULLS FIRST, sm.unit`,
      [id],
    );

    const entries = await query<{
      date: string;
      reason: 'purchase' | 'adjustment' | 'job_issue' | 'job_return';
      party: string | null;
      variant: string | null;
      unit: string;
      qty: number;
      note: string | null;
    }>(
      `SELECT sm.moved_on AS date, sm.reason, sm.qty::float8 AS qty, sm.unit, iv.color AS variant, sm.note,
              CASE WHEN sm.reason = 'purchase' THEN v.name
                   WHEN sm.reason IN ('job_issue','job_return') THEN k.name
                   ELSE NULL END AS party
       FROM stock_movements sm
       LEFT JOIN item_variants iv ON iv.id = sm.variant_id
       LEFT JOIN vendors v ON v.id = sm.vendor_id
       LEFT JOIN jobs j ON sm.reason IN ('job_issue','job_return') AND j.id = sm.ref_id
       LEFT JOIN karigars k ON k.id = j.karigar_id
       WHERE sm.item_id = $1
       ORDER BY sm.moved_on, sm.id`,
      [id],
    );

    return { onHand: onHand.rows, entries: entries.rows };
  },
};

async function replaceChildren(
  client: import('pg').PoolClient,
  itemId: number,
  units: string[],
  variants: string[],
) {
  const cleanUnits = dedupe(units);
  const cleanVariants = dedupe(variants);

  // Units have no inbound FK — safe to fully replace.
  await client.query('DELETE FROM item_units WHERE item_id = $1', [itemId]);
  for (let i = 0; i < cleanUnits.length; i++) {
    await client.query(
      'INSERT INTO item_units (item_id, unit, is_default) VALUES ($1,$2,$3)',
      [itemId, cleanUnits[i], i === 0],
    );
  }

  // Variants ARE referenced by stock/purchase/job history — reconcile instead of
  // delete-and-recreate (a blind delete would hit an FK violation and 500 the edit).
  const existing = await client.query<{ id: number; color: string }>(
    'SELECT id, color FROM item_variants WHERE item_id = $1',
    [itemId],
  );
  const existingColors = new Set(existing.rows.map((r) => r.color.toLowerCase()));
  const desiredColors = new Set(cleanVariants.map((c) => c.toLowerCase()));

  // Add newly-requested colours.
  for (const color of cleanVariants) {
    if (!existingColors.has(color.toLowerCase())) {
      await client.query('INSERT INTO item_variants (item_id, color) VALUES ($1,$2)', [itemId, color]);
    }
  }
  // Remove colours the user dropped — but only if they have no history (else keep, can't delete).
  for (const row of existing.rows) {
    if (desiredColors.has(row.color.toLowerCase())) continue;
    const ref = await client.query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM stock_movements WHERE variant_id = $1)
          OR EXISTS (SELECT 1 FROM purchase_items WHERE variant_id = $1)
          OR EXISTS (SELECT 1 FROM job_issues WHERE variant_id = $1)`,
      [row.id],
    );
    if (ref.rowCount === 0) {
      await client.query('DELETE FROM item_variants WHERE id = $1', [row.id]);
    }
  }
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}
