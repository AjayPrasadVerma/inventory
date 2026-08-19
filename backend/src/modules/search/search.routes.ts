import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

/**
 * One result the UI can render and navigate to without knowing the entity's shape.
 * `matched` says WHY the row came back (e.g. "Colour: Maroon"), which is what makes
 * a search across many fields readable — otherwise a hit on a hidden column looks random.
 */
interface Hit {
  type: 'vendor' | 'karigar' | 'item' | 'product' | 'purchase' | 'job';
  id: number;
  title: string;
  subtitle: string | null;
  matched: string | null;
  /** Current on-hand, for the two stock-bearing types. "456 kilo, 59 litre" or "285". */
  stock: string | null;
  href: string;
}

const schema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

/** Rank exact hits above prefix hits above anything else, then alphabetically. */
const RANK = (col: string) => `CASE WHEN lower(${col}) = lower($1) THEN 0
       WHEN ${col} ILIKE $2 THEN 1 ELSE 2 END`;

searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, limit } = schema.parse(req.query);
    const exact = q;
    const prefix = `${q}%`;
    const like = `%${q}%`;
    const asId = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
    const p = [exact, prefix, like, limit];

    const [vendors, karigars, items, products, purchases, jobs] = await Promise.all([
      query<Hit>(
        `SELECT 'vendor' AS type, v.id, v.name AS title,
                NULLIF(concat_ws(' · ', v.city, v.phone), '') AS subtitle,
                CASE WHEN v.name ILIKE $3 THEN NULL
                     WHEN v.phone ILIKE $3 THEN 'Phone: ' || v.phone
                     WHEN v.city ILIKE $3 THEN 'City: ' || v.city
                     WHEN v.gst_no ILIKE $3 THEN 'GST: ' || v.gst_no
                     ELSE 'Notes' END AS matched,
                NULL AS stock,
                '/vendors/account?v=' || v.id AS href
         FROM vendors v
         WHERE v.is_active AND (v.name ILIKE $3 OR v.phone ILIKE $3 OR v.city ILIKE $3
                                OR v.gst_no ILIKE $3 OR v.notes ILIKE $3)
         ORDER BY ${RANK('v.name')}, v.name LIMIT $4`, p),

      query<Hit>(
        `SELECT 'karigar' AS type, k.id, k.name AS title,
                NULLIF(concat_ws(' · ', k.phone, array_to_string(k.product_types, ', ')), '') AS subtitle,
                CASE WHEN k.name ILIKE $3 THEN NULL
                     WHEN k.phone ILIKE $3 THEN 'Phone: ' || k.phone
                     WHEN array_to_string(k.product_types, ', ') ILIKE $3
                       THEN 'Makes: ' || array_to_string(k.product_types, ', ')
                     ELSE 'Notes' END AS matched,
                NULL AS stock,
                '/karigars/account?k=' || k.id AS href
         FROM karigars k
         WHERE k.is_active AND (k.name ILIKE $3 OR k.phone ILIKE $3 OR k.notes ILIKE $3
                                OR array_to_string(k.product_types, ', ') ILIKE $3)
         ORDER BY ${RANK('k.name')}, k.name LIMIT $4`, p),

      query<Hit>(
        `SELECT 'item' AS type, i.id, i.name AS title,
                NULLIF(concat_ws(' · ', i.category,
                  (SELECT string_agg(DISTINCT u.unit, ', ') FROM item_units u WHERE u.item_id = i.id)), '') AS subtitle,
                CASE WHEN i.name ILIKE $3 THEN NULL
                     WHEN i.category ILIKE $3 THEN 'Category: ' || i.category
                     WHEN EXISTS (SELECT 1 FROM item_variants v WHERE v.item_id = i.id AND v.color ILIKE $3)
                       THEN 'Colour: ' || (SELECT string_agg(v.color, ', ') FROM item_variants v
                                           WHERE v.item_id = i.id AND v.color ILIKE $3)
                     WHEN EXISTS (SELECT 1 FROM item_units u WHERE u.item_id = i.id AND u.unit ILIKE $3)
                       THEN 'Unit match' ELSE 'Notes' END AS matched,
                (SELECT string_agg(rtrim(trim(to_char(x.qty, 'FM999999990.999')), '.') || ' ' || x.unit, ', ' ORDER BY x.unit)
                   FROM (SELECT sm.unit, SUM(sm.qty) AS qty FROM stock_movements sm
                         WHERE sm.item_id = i.id GROUP BY sm.unit HAVING SUM(sm.qty) <> 0) x) AS stock,
                '/items/stock?i=' || i.id AS href
         FROM items i
         WHERE i.is_active AND (i.name ILIKE $3 OR i.category ILIKE $3 OR i.notes ILIKE $3
                                OR EXISTS (SELECT 1 FROM item_variants v WHERE v.item_id = i.id AND v.color ILIKE $3)
                                OR EXISTS (SELECT 1 FROM item_units u WHERE u.item_id = i.id AND u.unit ILIKE $3))
         ORDER BY ${RANK('i.name')}, i.name LIMIT $4`, p),

      query<Hit>(
        `SELECT 'product' AS type, p.id, p.name AS title,
                NULLIF(concat_ws(' · ', p.category,
                  (SELECT string_agg(DISTINCT pv.variant, ', ') FROM product_variants pv WHERE pv.product_id = p.id)), '') AS subtitle,
                CASE WHEN p.name ILIKE $3 THEN NULL
                     WHEN p.category ILIKE $3 THEN 'Category: ' || p.category
                     WHEN EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.variant ILIKE $3)
                       THEN 'Variant: ' || (SELECT string_agg(pv.variant, ', ') FROM product_variants pv
                                            WHERE pv.product_id = p.id AND pv.variant ILIKE $3)
                     ELSE 'Notes' END AS matched,
                (SELECT rtrim(trim(to_char(COALESCE(SUM(f.qty), 0), 'FM999999990.999')), '.') || ' pcs'
                   FROM finished_stock_movements f WHERE f.product_id = p.id) AS stock,
                '/products/stock?p=' || p.id AS href
         FROM products p
         WHERE p.is_active AND (p.name ILIKE $3 OR p.category ILIKE $3 OR p.notes ILIKE $3
                                OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.variant ILIKE $3))
         ORDER BY ${RANK('p.name')}, p.name LIMIT $4`, p),

      // A bill number is often the fastest way back to a purchase — land on the
      // vendor's khata, which is where that bill now lives.
      query<Hit>(
        `SELECT 'purchase' AS type, pu.id,
                COALESCE('Bill ' || pu.bill_no, 'Purchase #' || pu.id) AS title,
                concat_ws(' · ', v.name, to_char(pu.purchase_date, 'DD/MM/YYYY')) AS subtitle,
                'Bill no.' AS matched,
                NULL AS stock,
                '/vendors/account?v=' || pu.vendor_id AS href
         FROM purchases pu JOIN vendors v ON v.id = pu.vendor_id
         WHERE pu.bill_no ILIKE $3
         ORDER BY ${RANK('pu.bill_no')}, pu.purchase_date DESC LIMIT $4`, p),

      asId
        ? query<Hit>(
            `SELECT 'job' AS type, j.id, 'Job #' || j.id AS title,
                    concat_ws(' · ', k.name, to_char(j.job_date, 'DD/MM/YYYY'), j.status) AS subtitle,
                    'Job number' AS matched,
                    NULL AS stock,
                    '/jobs/detail?j=' || j.id AS href
             FROM jobs j JOIN karigars k ON k.id = j.karigar_id
             WHERE j.id = $1 LIMIT $2`, [asId, limit])
        : Promise.resolve({ rows: [] as Hit[] }),
    ]);

    const groups = [
      { key: 'vendors', label: 'Vendors', hits: vendors.rows },
      { key: 'karigars', label: 'Karigars', hits: karigars.rows },
      { key: 'items', label: 'Raw materials', hits: items.rows },
      { key: 'products', label: 'Products', hits: products.rows },
      { key: 'purchases', label: 'Purchases', hits: purchases.rows },
      { key: 'jobs', label: 'Jobs', hits: jobs.rows },
    ].filter((g) => g.hits.length > 0);

    res.json({ data: { groups, total: groups.reduce((n, g) => n + g.hits.length, 0) } });
  }),
);
