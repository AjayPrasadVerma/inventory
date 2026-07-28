import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';
import { dateStringSchema } from '../../utils/validation.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/** Optional from/to date-range query, validated as ISO date strings (bad dates → clean 400, not a DB 500). */
const rangeQuery = z.object({ from: dateStringSchema.optional(), to: dateStringSchema.optional() });

/**
 * Raw material stock on hand — grouped by item + colour + unit.
 * Sums signed stock_movements. Also flags low stock vs item.low_stock_qty.
 */
reportsRouter.get(
  '/raw-stock',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT i.id AS item_id, i.name AS item_name, i.category,
              sm.variant_id, iv.color, sm.unit,
              SUM(sm.qty) AS on_hand,
              i.low_stock_qty,
              (i.low_stock_qty IS NOT NULL AND SUM(sm.qty) <= i.low_stock_qty) AS is_low
       FROM stock_movements sm
       JOIN items i ON i.id = sm.item_id
       LEFT JOIN item_variants iv ON iv.id = sm.variant_id
       GROUP BY i.id, i.name, i.category, sm.variant_id, iv.color, sm.unit, i.low_stock_qty
       HAVING SUM(sm.qty) <> 0
       ORDER BY i.name, iv.color NULLS FIRST, sm.unit`,
    );
    res.json({ data: rows });
  }),
);

/**
 * Raw material received per vendor (which vendor a material came from).
 * Report ii from the plan.
 */
reportsRouter.get(
  '/raw-by-vendor',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT v.id AS vendor_id, v.name AS vendor_name,
              i.id AS item_id, i.name AS item_name, iv.color, sm.unit,
              SUM(sm.qty) AS received_qty
       FROM stock_movements sm
       JOIN items i ON i.id = sm.item_id
       JOIN vendors v ON v.id = sm.vendor_id
       LEFT JOIN item_variants iv ON iv.id = sm.variant_id
       WHERE sm.reason = 'purchase'
       GROUP BY v.id, v.name, i.id, i.name, iv.color, sm.unit
       ORDER BY v.name, i.name`,
    );
    res.json({ data: rows });
  }),
);

/**
 * Finished-goods stock on hand — grouped by product + variant.
 * Sums signed finished_stock_movements (job receipts in, sales out).
 */
reportsRouter.get(
  '/finished-stock',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT p.id AS product_id, p.name AS product_name, p.category,
              fsm.variant_id, pv.variant,
              SUM(fsm.qty) AS on_hand,
              p.low_stock_qty,
              (p.low_stock_qty IS NOT NULL AND SUM(fsm.qty) <= p.low_stock_qty) AS is_low
       FROM finished_stock_movements fsm
       JOIN products p ON p.id = fsm.product_id
       LEFT JOIN product_variants pv ON pv.id = fsm.variant_id
       GROUP BY p.id, p.name, p.category, fsm.variant_id, pv.variant, p.low_stock_qty
       HAVING SUM(fsm.qty) <> 0
       ORDER BY p.name, pv.variant NULLS FIRST`,
    );
    res.json({ data: rows });
  }),
);

/** Helper: build an optional date-range WHERE on a given date column. */
function dateRange(col: string, from: unknown, to: unknown) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (typeof from === 'string' && from) { params.push(from); where.push(`${col} >= $${params.length}`); }
  if (typeof to === 'string' && to) { params.push(to); where.push(`${col} <= $${params.length}`); }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Sales report — product-wise sale value over a date range, plus a summary.
 * Owner priority: product-wise sale value.
 */
reportsRouter.get(
  '/sales-report',
  asyncHandler(async (req, res) => {
    const range = rangeQuery.parse(req.query);
    const items = dateRange('s.sale_date', range.from, range.to);
    const products = await query(
      `SELECT p.name AS product_name, pv.variant,
              SUM(si.qty) AS qty, SUM(si.qty * si.price) AS value
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN product_variants pv ON pv.id = si.variant_id
       ${items.clause}
       GROUP BY p.name, pv.variant
       ORDER BY SUM(si.qty * si.price) DESC`,
      items.params,
    );
    const s = dateRange('sale_date', range.from, range.to);
    const summary = await query<{ total: string; received: string; count: number }>(
      `SELECT COALESCE(SUM(total_amount),0) AS total,
              COALESCE(SUM(amount_received),0) AS received,
              COUNT(*)::int AS count
       FROM sales ${s.clause}`,
      s.params,
    );
    res.json({ data: { products: products.rows, summary: summary.rows[0] } });
  }),
);

/**
 * Material issued to karigars — which karigar got how much raw material & when.
 * Owner priority. Detailed (date-wise) so the "& when" is answered.
 */
reportsRouter.get(
  '/karigar-issued',
  asyncHandler(async (req, res) => {
    const range = rangeQuery.parse(req.query);
    const d = dateRange('ji.issued_on', range.from, range.to);
    const { rows } = await query(
      `SELECT ji.issued_on AS date, k.name AS karigar_name, j.id AS job_id,
              i.name AS item_name, iv.color, ji.unit, ji.qty
       FROM job_issues ji
       JOIN jobs j ON j.id = ji.job_id
       JOIN karigars k ON k.id = j.karigar_id
       JOIN items i ON i.id = ji.item_id
       LEFT JOIN item_variants iv ON iv.id = ji.variant_id
       ${d.clause}
       ORDER BY ji.issued_on DESC, ji.id DESC`,
      d.params,
    );
    res.json({ data: rows });
  }),
);

// Raw + finished stock lines that are oversold (on_hand < 0) or at/below their low-stock alert.
const LOW_STOCK_SQL = `
  WITH stock AS (
    SELECT 'Raw' AS kind, i.name AS name, i.category AS category, iv.color AS variant, sm.unit AS unit,
           SUM(sm.qty) AS on_hand,
           (i.low_stock_qty IS NOT NULL AND SUM(sm.qty) <= i.low_stock_qty) AS is_low
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    LEFT JOIN item_variants iv ON iv.id = sm.variant_id
    GROUP BY i.id, i.name, i.category, iv.color, sm.unit, i.low_stock_qty
    HAVING SUM(sm.qty) <> 0
    UNION ALL
    SELECT 'Finished' AS kind, p.name AS name, p.category AS category, pv.variant AS variant, NULL::text AS unit,
           SUM(fsm.qty) AS on_hand,
           (p.low_stock_qty IS NOT NULL AND SUM(fsm.qty) <= p.low_stock_qty) AS is_low
    FROM finished_stock_movements fsm
    JOIN products p ON p.id = fsm.product_id
    LEFT JOIN product_variants pv ON pv.id = fsm.variant_id
    GROUP BY p.id, p.name, p.category, pv.variant, p.low_stock_qty
    HAVING SUM(fsm.qty) <> 0
  )
  SELECT kind, name, category, variant, unit, on_hand, is_low
  FROM stock
  WHERE on_hand < 0 OR is_low
  ORDER BY on_hand ASC`;

// Finished goods (all same unit = pieces) available on hand, per category.
const FINISHED_BY_CAT_SQL = `
  WITH fin AS (
    SELECT p.category, SUM(fsm.qty) AS on_hand
    FROM finished_stock_movements fsm
    JOIN products p ON p.id = fsm.product_id
    GROUP BY p.id, p.category, fsm.variant_id
    HAVING SUM(fsm.qty) <> 0
  )
  SELECT COALESCE(category, 'Other') AS label, SUM(GREATEST(on_hand, 0))::float8 AS value
  FROM fin GROUP BY category ORDER BY value DESC`;

// Raw materials have mixed units (meter/kilo/piece) so we count in-stock lines per category, not qty.
const RAW_LINES_BY_CAT_SQL = `
  WITH raw AS (
    SELECT i.category, i.id, sm.variant_id, sm.unit
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    GROUP BY i.id, i.category, sm.variant_id, sm.unit
    HAVING SUM(sm.qty) <> 0
  )
  SELECT COALESCE(category, 'Other') AS label, COUNT(*)::int AS value
  FROM raw GROUP BY category ORDER BY value DESC`;

/**
 * Low / oversold stock — the actionable list for the dashboard "Needs attention" section
 * and the Low/Oversold report page. Single query so neither has to download the full ledger.
 */
reportsRouter.get(
  '/low-stock',
  asyncHandler(async (_req, res) => {
    const { rows } = await query<{ kind: string; name: string; category: string | null; variant: string | null; unit: string | null; on_hand: string; is_low: boolean }>(LOW_STOCK_SQL);
    res.json({ data: rows });
  }),
);

/**
 * Dashboard summary for the home screen. This business does NOT track money on
 * sales/purchases, so the dashboard is stock- and activity-based, not revenue-based.
 * Everything the home screen needs is returned here in ONE request (counts, today's
 * activity, category rollups, and the low/oversold list) so the client doesn't have to
 * download the full stock ledger and recompute — important on slow connections.
 */
reportsRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const count = (sql: string) => query<{ count: string }>(sql);
    const [items, products, vendors, karigars, customers, openJobs, purchasesToday, salesToday, issuesToday, lowStock, finByCat, rawByCat] =
      await Promise.all([
        count('SELECT COUNT(*)::int AS count FROM items WHERE is_active'),
        count('SELECT COUNT(*)::int AS count FROM products WHERE is_active'),
        count('SELECT COUNT(*)::int AS count FROM vendors WHERE is_active'),
        count('SELECT COUNT(*)::int AS count FROM karigars WHERE is_active'),
        count('SELECT COUNT(*)::int AS count FROM customers'),
        count(`SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'open'`),
        count(`SELECT COUNT(*)::int AS count FROM purchases WHERE purchase_date = CURRENT_DATE`),
        count(`SELECT COUNT(*)::int AS count FROM sales WHERE sale_date = CURRENT_DATE`),
        count(`SELECT COUNT(*)::int AS count FROM job_issues WHERE issued_on = CURRENT_DATE`),
        query<{ kind: string; name: string; category: string | null; variant: string | null; unit: string | null; on_hand: string; is_low: boolean }>(LOW_STOCK_SQL),
        query<{ label: string; value: number }>(FINISHED_BY_CAT_SQL),
        query<{ label: string; value: number }>(RAW_LINES_BY_CAT_SQL),
      ]);

    const n = (r: { rows: { count: string }[] }) => Number(r.rows[0]?.count ?? 0);
    const attention = lowStock.rows.map((r) => ({
      kind: r.kind,
      name: r.name,
      variant: r.variant,
      unit: r.unit,
      on_hand: r.on_hand,
      status: Number(r.on_hand) < 0 ? 'Oversold' : 'Low',
    }));
    const finishedByCategory = finByCat.rows.map((r) => ({ label: r.label, value: Number(r.value) }));
    const rawByCategory = rawByCat.rows.map((r) => ({ label: r.label, value: Number(r.value) }));
    const finishedTotal = finishedByCategory.reduce((s, r) => s + r.value, 0);

    res.json({
      data: {
        rawMaterials: n(items),
        products: n(products),
        vendors: n(vendors),
        karigars: n(karigars),
        customers: n(customers),
        openJobs: n(openJobs),
        purchasesToday: n(purchasesToday),
        salesToday: n(salesToday),
        issuesToday: n(issuesToday),
        lowStockCount: attention.length,
        attention,
        finishedTotal,
        finishedByCategory,
        rawByCategory,
      },
    });
  }),
);
