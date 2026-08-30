import { query, withTransaction } from '../../config/db.js';
import { likeTerm } from '../../utils/sql.js';

export interface ProductRow {
  id: number;
  name: string;
  category: string | null;
  low_stock_qty: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  variants: string[];
  variant_options: { id: number; variant: string }[];
  on_hand: number;
}

export interface ProductInput {
  name: string;
  category?: string | null;
  low_stock_qty?: number | null;
  notes?: string | null;
  /** Either the old bare labels, or size/design pairs from the edit form. */
  variants: VariantInput[];
  /** One-time opening stock at create (onboarding); variant=null for a no-variant product. */
  opening?: { variant: string | null; qty: number }[];
}

const SORTABLE: Record<string, string> = { name: 'name', category: 'category', created_at: 'created_at' };

const SELECT_WITH_VARIANTS = `
  SELECT p.*,
    COALESCE(array_agg(DISTINCT pv.variant) FILTER (WHERE pv.variant IS NOT NULL), '{}') AS variants,
    COALESCE(
      json_agg(DISTINCT jsonb_build_object('id', pv.id, 'variant', pv.variant)) FILTER (WHERE pv.id IS NOT NULL),
      '[]'
    ) AS variant_options,
    COALESCE((SELECT SUM(fsm.qty)::float8 FROM finished_stock_movements fsm WHERE fsm.product_id = p.id), 0) AS on_hand
  FROM products p
  LEFT JOIN product_variants pv ON pv.product_id = p.id
`;

export const productsRepo = {
  /** Lightweight picker options: id, name, variants. No stock aggregate. */
  async options(): Promise<{ id: number; name: string; variant_options: { id: number; variant: string }[] }[]> {
    const { rows } = await query<{ id: number; name: string; variant_options: { id: number; variant: string }[] }>(
      `SELECT p.id, p.name,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', pv.id, 'variant', pv.variant)) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variant_options
       FROM products p
       LEFT JOIN product_variants pv ON pv.product_id = p.id
       WHERE p.is_active = TRUE
       GROUP BY p.id, p.name
       ORDER BY p.name`,
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
  }): Promise<{ rows: ProductRow[]; total: number }> {
    const where: string[] = ['p.is_active = TRUE'];
    const params: unknown[] = [];

    if (opts.search) {
      params.push(likeTerm(opts.search));
      where.push(`p.name ILIKE $${params.length} ESCAPE '\\'`);
    }
    if (opts.category) {
      params.push(opts.category);
      where.push(`p.category = $${params.length}`);
    }

    const sortCol = SORTABLE[opts.sort ?? 'name'] ?? 'name';
    const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM products p ${whereSql}`,
      params,
    );
    const rowsRes = await query<ProductRow>(
      `${SELECT_WITH_VARIANTS} ${whereSql}
       GROUP BY p.id
       ORDER BY p.${sortCol} ${dir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number): Promise<ProductRow | null> {
    const { rows } = await query<ProductRow>(
      `${SELECT_WITH_VARIANTS} WHERE p.id = $1 GROUP BY p.id`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create(input: ProductInput): Promise<ProductRow> {
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO products (name, category, low_stock_qty, notes)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.name, input.category ?? null, input.low_stock_qty ?? null, input.notes ?? null],
      );
      const newId = rows[0]!.id;
      await replaceVariants(client, newId, input.variants);

      // One-time opening stock → an 'adjustment' movement per variant (onboarding).
      const opening = (input.opening ?? []).filter((o) => o.qty > 0);
      if (opening.length > 0) {
        const vres = await client.query<{ id: number; variant: string }>(
          'SELECT id, variant FROM product_variants WHERE product_id = $1',
          [newId],
        );
        const byName = new Map(vres.rows.map((v) => [v.variant.toLowerCase(), v.id]));
        for (const o of opening) {
          const variantId = o.variant ? byName.get(o.variant.toLowerCase()) ?? null : null;
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, note)
             VALUES ($1, $2, $3, 'adjustment', 'Opening stock')`,
            [newId, variantId, o.qty],
          );
        }
      }
      return newId;
    });
    return (await this.findById(id))!;
  },

  async update(id: number, input: ProductInput): Promise<ProductRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE products SET name=$2, category=$3, low_stock_qty=$4, notes=$5, updated_at=now() WHERE id=$1`,
        [id, input.name, input.category ?? null, input.low_stock_qty ?? null, input.notes ?? null],
      );
      await replaceVariants(client, id, input.variants);
    });
    return this.findById(id);
  },

  async softDelete(id: number): Promise<boolean> {
    const res = await query('UPDATE products SET is_active=FALSE, updated_at=now() WHERE id=$1', [id]);
    return (res.rowCount ?? 0) > 0;
  },

  async distinctCategories(): Promise<string[]> {
    const { rows } = await query<{ category: string }>(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> '' ORDER BY category`,
    );
    return rows.map((r) => r.category);
  },

  async stockAccount(id: number): Promise<{
    onHand: { variant: string | null; qty: number }[];
    entries: {
      date: string;
      reason: 'job_receipt' | 'sale' | 'adjustment' | 'purchase';
      party: string | null;
      variant: string | null;
      qty: number;
      note: string | null;
    }[];
  } | null> {
    const ex = await query('SELECT id FROM products WHERE id = $1', [id]);
    if (!ex.rows[0]) return null;

    const onHand = await query<{ variant: string | null; qty: number }>(
      `SELECT pv.variant, SUM(fsm.qty)::float8 AS qty
       FROM finished_stock_movements fsm
       LEFT JOIN product_variants pv ON pv.id = fsm.variant_id
       WHERE fsm.product_id = $1
       GROUP BY pv.variant
       HAVING SUM(fsm.qty) <> 0
       ORDER BY pv.variant NULLS FIRST`,
      [id],
    );

    const entries = await query<{
      date: string;
      reason: 'job_receipt' | 'sale' | 'adjustment' | 'purchase';
      party: string | null;
      variant: string | null;
      qty: number;
      note: string | null;
    }>(
      `SELECT fsm.moved_on AS date, fsm.reason, fsm.qty::float8 AS qty, pv.variant, fsm.note,
              CASE WHEN fsm.reason = 'job_receipt' THEN k.name
                   WHEN fsm.reason = 'sale' THEN COALESCE(c.name, c.mobile, 'Walk-in')
                   -- Bought-in finished goods: show the vendor they came from.
                   WHEN fsm.reason = 'purchase' THEN v.name
                   ELSE NULL END AS party
       FROM finished_stock_movements fsm
       LEFT JOIN product_variants pv ON pv.id = fsm.variant_id
       LEFT JOIN jobs j ON fsm.reason = 'job_receipt' AND j.id = fsm.ref_id
       LEFT JOIN karigars k ON k.id = j.karigar_id
       LEFT JOIN sales sa ON fsm.reason = 'sale' AND sa.id = fsm.ref_id
       LEFT JOIN customers c ON c.id = sa.customer_id
       LEFT JOIN vendors v ON v.id = fsm.vendor_id
       WHERE fsm.product_id = $1
       ORDER BY fsm.moved_on, fsm.id`,
      [id],
    );

    return { onHand: onHand.rows, entries: entries.rows };
  },
};

/** A variant as the edit form sends it. A bare string is the old shape — the
 *  composed label with nothing to split it by — and is kept so older callers do
 *  not break. */
export type VariantInput = string | { size?: string | null; design?: string | null };

/** The label a variant is displayed and matched under. */
function variantLabel(v: VariantInput): string {
  if (typeof v === 'string') return v.trim();
  return [(v.size ?? '').trim(), (v.design ?? '').trim()].filter(Boolean).join(' · ');
}

async function replaceVariants(client: import('pg').PoolClient, productId: number, variants: VariantInput[]) {
  // Dedupe requested variants (case-insensitive, trimmed) by their label.
  const clean: { label: string; size: string | null; design: string | null }[] = [];
  const seen = new Set<string>();
  for (const raw of variants) {
    const label = variantLabel(raw);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    // A pair keeps its parts; a bare string has none to keep, and inventing them
    // by splitting the label would guess at data the caller never sent.
    clean.push(typeof raw === 'string'
      ? { label, size: null, design: null }
      : { label, size: (raw.size ?? '').trim() || null, design: (raw.design ?? '').trim() || null });
  }

  // Variants are referenced by finished_stock/sale/job_receipt history — reconcile,
  // don't delete-and-recreate (a blind delete would hit an FK violation and 500 the edit).
  const existing = await client.query<{ id: number; variant: string }>(
    'SELECT id, variant FROM product_variants WHERE product_id = $1',
    [productId],
  );
  const existingLc = new Set(existing.rows.map((r) => r.variant.toLowerCase()));
  const desiredLc = new Set(clean.map((c) => c.label.toLowerCase()));

  // A row that already exists gets its parts refreshed: an edit that renames a
  // size has to land on the columns, not only on the label.
  for (const c of clean) {
    if (existingLc.has(c.label.toLowerCase()) && (c.size !== null || c.design !== null)) {
      await client.query(
        `UPDATE product_variants SET size = $3, design = $4
         WHERE product_id = $1 AND lower(variant) = lower($2)`,
        [productId, c.label, c.size, c.design],
      );
    }
  }

  for (const { label: variant, size, design } of clean) {
    if (!existingLc.has(variant.toLowerCase())) {
      await client.query(
        'INSERT INTO product_variants (product_id, variant, size, design) VALUES ($1,$2,$3,$4)',
        [productId, variant, size, design],
      );
    }
  }
  for (const row of existing.rows) {
    if (desiredLc.has(row.variant.toLowerCase())) continue;
    const ref = await client.query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM finished_stock_movements WHERE variant_id = $1)
          OR EXISTS (SELECT 1 FROM sale_items WHERE variant_id = $1)
          OR EXISTS (SELECT 1 FROM job_receipts WHERE variant_id = $1)`,
      [row.id],
    );
    if (ref.rowCount === 0) {
      await client.query('DELETE FROM product_variants WHERE id = $1', [row.id]);
    }
  }
}
