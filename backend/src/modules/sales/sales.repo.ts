import { query, withTransaction } from '../../config/db.js';

export interface SaleItemInput {
  product_id: number;
  variant_id?: number | null;
  qty: number;
  price: number;
}

export interface SaleInput {
  mobile?: string | null;
  customer_name?: string | null;
  type: 'retail' | 'wholesale';
  sale_date?: string | null;
  payment_mode: 'cash' | 'credit';
  amount_received?: number | null;
  notes?: string | null;
  items: SaleItemInput[];
  created_by?: number | null;
}

export interface SaleListItem {
  name: string;
  variant: string | null;
  qty: string;
}

export interface SaleListRow {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_mobile: string | null;
  sale_date: string;
  type: 'retail' | 'wholesale';
  total_amount: string;
  amount_received: string;
  payment_mode: 'cash' | 'credit';
  created_at: string;
  items: SaleListItem[];
}

export interface SaleEditInput {
  type?: 'retail' | 'wholesale';
  sale_date?: string | null;
  items?: SaleItemInput[];
}

export const salesRepo = {
  async create(input: SaleInput): Promise<{ id: number }> {
    const items = input.items.map((it) => ({
      ...it,
      amount: Number((it.qty * it.price).toFixed(2)),
    }));
    const total = items.reduce((s, it) => s + it.amount, 0);
    const received =
      input.payment_mode === 'cash' ? total : Math.min(Number(input.amount_received ?? 0), total);

    return withTransaction(async (client) => {
      // Resolve customer by mobile (auto-create / update name). Walk-in without mobile => null.
      let customerId: number | null = null;
      if (input.mobile && input.mobile.trim()) {
        const cust = await client.query<{ id: number }>(
          `INSERT INTO customers (mobile, name, type, credit_allowed)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (mobile) DO UPDATE
             SET name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
                 credit_allowed = customers.credit_allowed OR EXCLUDED.credit_allowed,
                 updated_at = now()
           RETURNING id`,
          [input.mobile.trim(), input.customer_name ?? null, input.type, input.payment_mode === 'credit'],
        );
        customerId = cust.rows[0]!.id;
      }

      const saleRes = await client.query<{ id: number }>(
        `INSERT INTO sales (customer_id, sale_date, type, total_amount, amount_received, payment_mode, notes, created_by)
         VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8) RETURNING id`,
        [customerId, input.sale_date ?? null, input.type, total, received, input.payment_mode, input.notes ?? null, input.created_by ?? null],
      );
      const saleId = saleRes.rows[0]!.id;

      for (const it of items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, variant_id, qty, price, amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [saleId, it.product_id, it.variant_id ?? null, it.qty, it.price, it.amount],
        );
        // Finished goods leave stock (negative movement).
        await client.query(
          `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
           VALUES ($1,$2,$3,'sale',$4, COALESCE($5, CURRENT_DATE))`,
          [it.product_id, it.variant_id ?? null, -Math.abs(it.qty), saleId, input.sale_date ?? null],
        );
      }

      return { id: saleId };
    });
  },

  async list(opts: {
    search?: string;
    type?: 'retail' | 'wholesale';
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: SaleListRow[]; total: number }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      where.push(`(c.name ILIKE ${p} OR c.mobile ILIKE ${p})`);
    }
    if (opts.type) {
      params.push(opts.type);
      where.push(`s.type = $${params.length}`);
    }
    if (opts.from) {
      params.push(opts.from);
      where.push(`s.sale_date >= $${params.length}`);
    }
    if (opts.to) {
      params.push(opts.to);
      where.push(`s.sale_date <= $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${whereSql}`,
      params,
    );
    const rowsRes = await query<Omit<SaleListRow, 'items'>>(
      `SELECT s.id, s.customer_id, c.name AS customer_name, c.mobile AS customer_mobile,
              s.sale_date, s.type, s.total_amount, s.amount_received, s.payment_mode, s.created_at
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${whereSql}
       ORDER BY s.sale_date DESC, s.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );

    // Attach the sold lines for the page's sales in one grouped query.
    const ids = rowsRes.rows.map((r) => r.id);
    const itemsBySale = new Map<number, SaleListItem[]>();
    if (ids.length) {
      const itemRows = await query<SaleListItem & { sale_id: number }>(
        `SELECT si.sale_id, p.name, pv.variant, si.qty
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         LEFT JOIN product_variants pv ON pv.id = si.variant_id
         WHERE si.sale_id = ANY($1)
         ORDER BY si.id`,
        [ids],
      );
      for (const it of itemRows.rows) {
        const { sale_id, ...rest } = it;
        const arr = itemsBySale.get(sale_id);
        if (arr) arr.push(rest);
        else itemsBySale.set(sale_id, [rest]);
      }
    }

    const rows: SaleListRow[] = rowsRes.rows.map((r) => ({
      ...r,
      items: itemsBySale.get(r.id) ?? [],
    }));
    return { rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number) {
    const head = await query<SaleListRow & { notes: string | null }>(
      `SELECT s.id, s.customer_id, c.name AS customer_name, c.mobile AS customer_mobile,
              s.sale_date, s.type, s.total_amount, s.amount_received, s.payment_mode, s.notes, s.created_at
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = $1`,
      [id],
    );
    if (!head.rows[0]) return null;
    const items = await query(
      `SELECT si.id, si.product_id, p.name AS product_name, si.variant_id, pv.variant,
              si.qty, si.price, si.amount
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       LEFT JOIN product_variants pv ON pv.id = si.variant_id
       WHERE si.sale_id = $1 ORDER BY si.id`,
      [id],
    );
    return { ...head.rows[0], items: items.rows };
  },

  /** Fully delete a sale and reverse its finished-stock movements (owner-only at route level). */
  async deleteRow(id: number): Promise<boolean> {
    return withTransaction(async (client) => {
      const ex = await client.query('SELECT id FROM sales WHERE id = $1', [id]);
      if (!ex.rows[0]) return false;
      await client.query(
        `DELETE FROM finished_stock_movements WHERE ref_id = $1 AND reason = 'sale'`,
        [id],
      );
      await client.query(`DELETE FROM sale_items WHERE sale_id = $1`, [id]);
      await client.query(`DELETE FROM sales WHERE id = $1`, [id]);
      return true;
    });
  },

  /**
   * Edit a sale in a single transaction: update the provided head fields and,
   * when `items` is present, REPLACE all lines — reversing old finished stock,
   * applying the new lines, and recomputing `total_amount`. `amount_received`,
   * `customer_id` and `payment_mode` are left unchanged.
   */
  async editRow(id: number, input: SaleEditInput): Promise<boolean> {
    return withTransaction(async (client) => {
      const ex = await client.query<{ sale_date: string }>(
        'SELECT sale_date FROM sales WHERE id = $1',
        [id],
      );
      if (!ex.rows[0]) return false;

      await client.query(
        `UPDATE sales SET
           type      = COALESCE($2, type),
           sale_date = COALESCE($3, sale_date)
         WHERE id = $1`,
        [id, input.type ?? null, input.sale_date ?? null],
      );

      if (input.items !== undefined) {
        // The movement date reflects the (possibly updated) sale head.
        const movedOn = input.sale_date ?? ex.rows[0].sale_date;

        await client.query(
          `DELETE FROM finished_stock_movements WHERE ref_id = $1 AND reason = 'sale'`,
          [id],
        );
        await client.query(`DELETE FROM sale_items WHERE sale_id = $1`, [id]);

        let total = 0;
        for (const it of input.items) {
          const amount = Number((it.qty * it.price).toFixed(2));
          total += amount;
          await client.query(
            `INSERT INTO sale_items (sale_id, product_id, variant_id, qty, price, amount)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [id, it.product_id, it.variant_id ?? null, it.qty, it.price, amount],
          );
          // Finished goods leave stock (negative movement).
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
             VALUES ($1,$2,$3,'sale',$4, COALESCE($5, CURRENT_DATE))`,
            [it.product_id, it.variant_id ?? null, -Math.abs(it.qty), id, movedOn],
          );
        }

        await client.query(`UPDATE sales SET total_amount = $2 WHERE id = $1`, [id, total]);
      }

      return true;
    });
  },
};
