/**
 * ⚠️  UNUSED — SALE / CUSTOMER MODULE, NOT PART OF THE CURRENT SCOPE
 *
 * The app is inventory-only right now. Sale and Customers are hidden from the
 * menu (see components/app-shell.tsx) and the owner has said no work is to be
 * done here. This file is kept, not deleted, so billing can be switched back on
 * later without rebuilding it — the routes, tables and data are all intact.
 *
 * Do not extend, refactor or "tidy" this file. If a change here looks necessary,
 * ask first: it almost certainly means something outside the module is wrong.
 */

import { query } from '../../config/db.js';

export interface CustomerRow {
  id: number;
  mobile: string | null;
  name: string | null;
  type: 'retail' | 'wholesale';
  credit_allowed: boolean;
  created_at: string;
  updated_at: string;
}

export const customersRepo = {
  /** Lightweight picker options — id/name/mobile, no balance subqueries. */
  async options(): Promise<{ id: number; name: string | null; mobile: string | null }[]> {
    const { rows } = await query<{ id: number; name: string | null; mobile: string | null }>(
      `SELECT id, name, mobile FROM customers ORDER BY name NULLS LAST, mobile`,
    );
    return rows;
  },

  async lookup(mobile: string): Promise<CustomerRow | null> {
    const { rows } = await query<CustomerRow>('SELECT * FROM customers WHERE mobile = $1', [mobile]);
    return rows[0] ?? null;
  },

  async list(opts: { search?: string; limit: number; offset: number }): Promise<{
    rows: (CustomerRow & { balance: string; sales_count: number })[];
    total: number;
  }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      where.push(`(name ILIKE ${p} OR mobile ILIKE ${p})`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Receivable = Σ(sale.total − sale.received) − Σ(payments received).
    const balanceExpr = `
      COALESCE((SELECT SUM(s.total_amount - s.amount_received) FROM sales s WHERE s.customer_id = c.id), 0)
      - COALESCE((SELECT SUM(pay.amount) FROM payments pay
                  WHERE pay.party_type = 'customer' AND pay.party_id = c.id AND pay.direction = 'received'), 0)
    `;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM customers c ${whereSql}`,
      params,
    );
    const rowsRes = await query<CustomerRow & { balance: string; sales_count: number }>(
      `SELECT c.*, (${balanceExpr}) AS balance,
              COALESCE((SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id), 0)::int AS sales_count
       FROM customers c ${whereSql}
       ORDER BY c.updated_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number): Promise<CustomerRow | null> {
    const { rows } = await query<CustomerRow>('SELECT * FROM customers WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async ledger(id: number): Promise<{
    entries: {
      date: string;
      type: 'sale' | 'payment';
      ref: string;
      credit: number;
      debit: number;
      items?: { name: string; variant: string | null; qty: string }[];
    }[];
  } | null> {
    const customer = await this.findById(id);
    if (!customer) return null;

    const sales = await query<{ sale_date: string; id: number; total_amount: string; amount_received: string }>(
      `SELECT id, sale_date, total_amount, amount_received FROM sales WHERE customer_id = $1`,
      [id],
    );
    const payments = await query<{ pay_date: string; id: number; amount: string; ref_note: string | null }>(
      `SELECT id, pay_date, amount, ref_note FROM payments
       WHERE party_type = 'customer' AND party_id = $1 AND direction = 'received'`,
      [id],
    );

    // Products sold on every sale of this customer, grouped by sale id.
    const itemRows = await query<{ sale_id: number; name: string; variant: string | null; qty: string }>(
      `SELECT si.sale_id, p.name, pv.variant, si.qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN product_variants pv ON pv.id = si.variant_id
       WHERE s.customer_id = $1
       ORDER BY si.id`,
      [id],
    );
    const itemsBySale = new Map<number, { name: string; variant: string | null; qty: string }[]>();
    for (const r of itemRows.rows) {
      const list = itemsBySale.get(r.sale_id) ?? [];
      list.push({ name: r.name, variant: r.variant, qty: r.qty });
      itemsBySale.set(r.sale_id, list);
    }

    const entries: {
      date: string;
      type: 'sale' | 'payment';
      ref: string;
      credit: number;
      debit: number;
      items?: { name: string; variant: string | null; qty: string }[];
    }[] = [];
    for (const s of sales.rows) {
      entries.push({
        date: s.sale_date,
        type: 'sale',
        ref: `Sale #${s.id}`,
        credit: Number(s.total_amount),
        debit: Number(s.amount_received),
        items: itemsBySale.get(s.id) ?? [],
      });
    }
    for (const pay of payments.rows) {
      entries.push({ date: pay.pay_date, type: 'payment', ref: pay.ref_note ?? `Receipt #${pay.id}`, credit: 0, debit: Number(pay.amount) });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { entries };
  },
};
