import { query } from '../../config/db.js';

/**
 * SQL for the reports module.
 *
 * Only the day feed lives here so far. The rest of this module still builds its
 * queries inside the route, which CLAUDE.md §6 says not to do — that is older
 * than this file and is left alone rather than rewritten in passing, but
 * anything touched from here on should land in a repo like this one.
 *
 * This moved when the karigar line shape was fixed: a query inside a route
 * cannot be tested without standing up HTTP, and the payload this returns is
 * read by two clients now — the website and the phone — so it is worth pinning.
 */

export interface ActivityLine {
  name: string;
  variant: string | null;
  unit: string;
  qty: string;
}

export type ActivityKind = 'purchase' | 'issue' | 'receipt' | 'payment' | 'adjustment';

export interface ActivityEvent {
  kind: ActivityKind;
  id: number;
  party: string | null;
  ref: string;
  amount: number | null;
  lines: ActivityLine[];
  note: string | null;
}

export interface DayActivity {
  counts: Record<'purchases' | 'issues' | 'receipts' | 'payments' | 'adjustments', number>;
  paid: number;
  events: ActivityEvent[];
}

export const reportsRepo = {
  /**
   * Everything that happened on one day, as a single feed. Answers "aaj kya
   * hua?" without opening four different pages.
   *
   * `date` may be null, in which case SQL resolves CURRENT_DATE so the server's
   * day is used rather than whatever the caller thinks today is.
   */
  async dayActivity(date: string | null): Promise<DayActivity> {
    const d = date;

    const [purchases, issues, receipts, payments, adjustments] = await Promise.all([
      query(
        `SELECT p.id, v.name AS party, p.bill_no, p.total_amount AS amount,
                (SELECT json_agg(json_build_object(
                          'name', COALESCE(i.name, pr.name),
                          'variant', COALESCE(iv.color, pv.variant),
                          'unit', pi.unit, 'qty', pi.qty) ORDER BY pi.id)
                   FROM purchase_items pi
                   LEFT JOIN items i ON i.id = pi.item_id
                   LEFT JOIN item_variants iv ON iv.id = pi.variant_id
                   LEFT JOIN products pr ON pr.id = pi.product_id
                   LEFT JOIN product_variants pv ON pv.id = pi.product_variant_id
                  WHERE pi.purchase_id = p.id) AS lines
         FROM purchases p JOIN vendors v ON v.id = p.vendor_id
         WHERE p.purchase_date = COALESCE($1::date, CURRENT_DATE)
         ORDER BY p.id DESC`, [d]),

      query(
        `SELECT e.id, k.name AS party, e.remark,
                json_agg(json_build_object(
                  -- size and design go into the same two slots a purchase line
                  -- uses, rather than being concatenated into one. The owner
                  -- types the unit into size and the colour into design (see
                  -- karigar-entries repo), so they already mean "unit" and
                  -- "variant" — joining them produced lines that read
                  -- "Silk (meter) · 15" with the quantity carrying no unit at
                  -- all, and left every consumer guessing which half was which.
                  'name', COALESCE(i.name, pr.name),
                  'variant', NULLIF(l.design, ''),
                  'unit', COALESCE(l.size, ''), 'qty', l.qty) ORDER BY l.id) AS lines
         FROM karigar_entries e
         JOIN karigars k ON k.id = e.karigar_id
         JOIN karigar_entry_lines l ON l.entry_id = e.id
         LEFT JOIN items i ON i.id = l.item_id
         LEFT JOIN products pr ON pr.id = l.product_id
         WHERE e.direction = 'out' AND e.entry_date = COALESCE($1::date, CURRENT_DATE)
         GROUP BY e.id, k.name, e.remark ORDER BY e.id DESC`, [d]),

      query(
        `SELECT e.id, k.name AS party, e.remark,
                json_agg(json_build_object(
                  -- size and design go into the same two slots a purchase line
                  -- uses, rather than being concatenated into one. The owner
                  -- types the unit into size and the colour into design (see
                  -- karigar-entries repo), so they already mean "unit" and
                  -- "variant" — joining them produced lines that read
                  -- "Silk (meter) · 15" with the quantity carrying no unit at
                  -- all, and left every consumer guessing which half was which.
                  'name', COALESCE(i.name, pr.name),
                  'variant', NULLIF(l.design, ''),
                  'unit', COALESCE(l.size, ''), 'qty', l.qty) ORDER BY l.id) AS lines
         FROM karigar_entries e
         JOIN karigars k ON k.id = e.karigar_id
         JOIN karigar_entry_lines l ON l.entry_id = e.id
         LEFT JOIN items i ON i.id = l.item_id
         LEFT JOIN products pr ON pr.id = l.product_id
         WHERE e.direction = 'in' AND e.entry_date = COALESCE($1::date, CURRENT_DATE)
         GROUP BY e.id, k.name, e.remark ORDER BY e.id DESC`, [d]),

      query(
        `SELECT pay.id, pay.amount, pay.method, pay.party_type, pay.ref_note,
                CASE pay.party_type
                  WHEN 'vendor'  THEN (SELECT name FROM vendors  WHERE id = pay.party_id)
                  WHEN 'karigar' THEN (SELECT name FROM karigars WHERE id = pay.party_id)
                  ELSE (SELECT COALESCE(name, mobile) FROM customers WHERE id = pay.party_id) END AS party,
                COALESCE('Bill ' || (SELECT bill_no FROM purchases WHERE id = pay.purchase_id),
                         'Job #' || pay.job_id,
                         (SELECT COALESCE(NULLIF(remark, ''), 'Entry')
                            FROM karigar_entries WHERE id = pay.karigar_entry_id)) AS against
         FROM payments pay
         WHERE pay.pay_date = COALESCE($1::date, CURRENT_DATE)
         ORDER BY pay.id DESC`, [d]),

      // Opening stock and manual corrections — they change stock, so they belong here.
      query(
        `SELECT sm.id, i.name, iv.color AS variant, sm.unit, sm.qty, sm.note
         FROM stock_movements sm
         JOIN items i ON i.id = sm.item_id
         LEFT JOIN item_variants iv ON iv.id = sm.variant_id
         WHERE sm.reason = 'adjustment' AND sm.moved_on = COALESCE($1::date, CURRENT_DATE)
         ORDER BY sm.id DESC`, [d]),
    ]);

    type Line = ActivityLine;
    const feed = [
      ...purchases.rows.map((r: any) => ({
        kind: 'purchase' as const, id: r.id, party: r.party,
        ref: r.bill_no ? `Bill ${r.bill_no}` : `Purchase #${r.id}`,
        amount: Number(r.amount), lines: (r.lines ?? []) as Line[], note: null,
      })),
      ...issues.rows.map((r: any) => ({
        kind: 'issue' as const, id: r.id, party: r.party, ref: r.remark || 'Material out',
        amount: null, lines: (r.lines ?? []) as Line[], note: null,
      })),
      ...receipts.rows.map((r: any) => ({
        kind: 'receipt' as const, id: r.id, party: r.party, ref: r.remark || 'Item in',
        amount: null, lines: (r.lines ?? []) as Line[], note: null,
      })),
      ...payments.rows.map((r: any) => ({
        kind: 'payment' as const, id: r.id, party: r.party,
        ref: r.against ?? r.ref_note ?? r.method ?? 'Payment',
        amount: Number(r.amount), lines: [] as Line[], note: r.method,
      })),
      ...adjustments.rows.map((r: any) => ({
        kind: 'adjustment' as const, id: r.id, party: r.note ?? 'Stock adjustment',
        ref: r.note ?? 'Adjustment', amount: null,
        lines: [{ name: r.name, variant: r.variant, unit: r.unit, qty: r.qty }] as Line[], note: r.note,
      })),
    ];

    return {
      counts: {
        purchases: purchases.rowCount ?? 0,
        issues: issues.rowCount ?? 0,
        receipts: receipts.rowCount ?? 0,
        payments: payments.rowCount ?? 0,
        adjustments: adjustments.rowCount ?? 0,
      },
      paid: payments.rows.reduce((n: number, r: any) => n + Number(r.amount), 0),
      events: feed,
    };
  },
};
