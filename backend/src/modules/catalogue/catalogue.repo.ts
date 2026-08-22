import { query } from '../../config/db.js';

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
  /** Colours for a raw material, variants for a product. */
  variants: string[];
  /** Per unit for a raw material; a single "pcs" line for a product. */
  on_hand: { unit: string; qty: number }[];
}

const ITEM_SIDE = `
  SELECT 'item'::text AS kind, i.id, i.name, i.category, i.low_stock_qty, i.notes,
         COALESCE((SELECT array_agg(u.unit ORDER BY u.id) FROM item_units u WHERE u.item_id = i.id), '{}') AS units,
         COALESCE((SELECT array_agg(v.color ORDER BY v.color) FROM item_variants v WHERE v.item_id = i.id), '{}') AS variants,
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
