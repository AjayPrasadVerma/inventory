import { query, withTransaction } from '../../config/db.js';

export interface PurchaseItemInput {
  item_id: number;
  variant_id?: number | null;
  unit: string;
  qty: number;
  rate: number;
  amount?: number;
}

export interface PurchaseInput {
  vendor_id: number;
  bill_no?: string | null;
  purchase_date?: string | null;
  notes?: string | null;
  amount_paid?: number;
  items: PurchaseItemInput[];
  created_by?: number | null;
}

export interface PurchaseListItem {
  name: string;
  color: string | null;
  unit: string;
  qty: string;
}

export interface PurchaseListRow {
  id: number;
  vendor_id: number;
  vendor_name: string;
  bill_no: string | null;
  purchase_date: string;
  total_amount: string;
  amount_paid: string;
  created_at: string;
  items: PurchaseListItem[];
}

export interface PurchaseEditInput {
  vendor_id?: number;
  bill_no?: string | null;
  purchase_date?: string | null;
  items?: PurchaseItemInput[];
}

export const purchasesRepo = {
  async create(input: PurchaseInput): Promise<{ id: number }> {
    const items = input.items.map((it) => ({
      ...it,
      amount: it.amount ?? Number((it.qty * it.rate).toFixed(2)),
    }));
    const total = items.reduce((s, it) => s + it.amount, 0);

    return withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO purchases (vendor_id, bill_no, purchase_date, total_amount, amount_paid, notes, created_by)
         VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7) RETURNING id`,
        [
          input.vendor_id,
          input.bill_no ?? null,
          input.purchase_date ?? null,
          total,
          input.amount_paid ?? 0,
          input.notes ?? null,
          input.created_by ?? null,
        ],
      );
      const purchaseId = rows[0]!.id;

      for (const it of items) {
        await client.query(
          `INSERT INTO purchase_items (purchase_id, item_id, variant_id, unit, qty, rate, amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [purchaseId, it.item_id, it.variant_id ?? null, it.unit, it.qty, it.rate, it.amount],
        );
        // Inbound raw-material stock movement, tagged with the source vendor.
        await client.query(
          `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
           VALUES ($1,$2,$3,$4,'purchase',$5,$6, COALESCE($7, CURRENT_DATE))`,
          [it.item_id, it.variant_id ?? null, it.unit, it.qty, purchaseId, input.vendor_id, input.purchase_date ?? null],
        );
      }

      return { id: purchaseId };
    });
  },

  async list(opts: {
    search?: string;
    vendorId?: number;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: PurchaseListRow[]; total: number }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      where.push(`(p.bill_no ILIKE ${p} OR v.name ILIKE ${p})`);
    }
    if (opts.vendorId) {
      params.push(opts.vendorId);
      where.push(`p.vendor_id = $${params.length}`);
    }
    if (opts.from) {
      params.push(opts.from);
      where.push(`p.purchase_date >= $${params.length}`);
    }
    if (opts.to) {
      params.push(opts.to);
      where.push(`p.purchase_date <= $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM purchases p JOIN vendors v ON v.id = p.vendor_id ${whereSql}`,
      params,
    );
    const rowsRes = await query<Omit<PurchaseListRow, 'items'>>(
      `SELECT p.id, p.vendor_id, v.name AS vendor_name, p.bill_no, p.purchase_date,
              p.total_amount, p.amount_paid, p.created_at
       FROM purchases p JOIN vendors v ON v.id = p.vendor_id ${whereSql}
       ORDER BY p.purchase_date DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );

    // Attach the item lines for the page's purchases in one grouped query.
    const ids = rowsRes.rows.map((r) => r.id);
    const itemsByPurchase = new Map<number, PurchaseListItem[]>();
    if (ids.length) {
      const itemRows = await query<PurchaseListItem & { purchase_id: number }>(
        `SELECT pi.purchase_id, i.name, iv.color, pi.unit, pi.qty
         FROM purchase_items pi
         JOIN items i ON i.id = pi.item_id
         LEFT JOIN item_variants iv ON iv.id = pi.variant_id
         WHERE pi.purchase_id = ANY($1)
         ORDER BY pi.id`,
        [ids],
      );
      for (const it of itemRows.rows) {
        const { purchase_id, ...rest } = it;
        const arr = itemsByPurchase.get(purchase_id);
        if (arr) arr.push(rest);
        else itemsByPurchase.set(purchase_id, [rest]);
      }
    }

    const rows: PurchaseListRow[] = rowsRes.rows.map((r) => ({
      ...r,
      items: itemsByPurchase.get(r.id) ?? [],
    }));
    return { rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number) {
    const head = await query<PurchaseListRow & { notes: string | null }>(
      `SELECT p.id, p.vendor_id, v.name AS vendor_name, p.bill_no, p.purchase_date,
              p.total_amount, p.amount_paid, p.notes, p.created_at
       FROM purchases p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = $1`,
      [id],
    );
    if (!head.rows[0]) return null;

    const items = await query(
      `SELECT pi.id, pi.item_id, i.name AS item_name, pi.variant_id, iv.color,
              pi.unit, pi.qty, pi.rate, pi.amount
       FROM purchase_items pi
       JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants iv ON iv.id = pi.variant_id
       WHERE pi.purchase_id = $1 ORDER BY pi.id`,
      [id],
    );
    return { ...head.rows[0], items: items.rows };
  },

  /** Fully delete a purchase and reverse its stock movements (owner-only at route level). */
  async deleteRow(id: number): Promise<boolean> {
    return withTransaction(async (client) => {
      const ex = await client.query('SELECT id FROM purchases WHERE id = $1', [id]);
      if (!ex.rows[0]) return false;
      await client.query(
        `DELETE FROM stock_movements WHERE ref_id = $1 AND reason = 'purchase'`,
        [id],
      );
      await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);
      // Money paid against this bill goes with it, so the vendor's Outstanding is
      // reversed too. (The FK is ON DELETE SET NULL, which would otherwise leave
      // these behind as untraceable on-account payments.) Mirrors jobsRepo.deleteJob.
      await client.query(`DELETE FROM payments WHERE purchase_id = $1`, [id]);
      await client.query(`DELETE FROM purchases WHERE id = $1`, [id]);
      return true;
    });
  },

  /**
   * Edit a purchase in a single transaction: update the provided head fields and,
   * when `items` is present, REPLACE all lines — reversing old stock, applying the
   * new lines, and recomputing `total_amount`. `amount_paid` is left unchanged.
   */
  async editRow(id: number, input: PurchaseEditInput): Promise<boolean> {
    return withTransaction(async (client) => {
      const ex = await client.query<{ vendor_id: number; purchase_date: string }>(
        'SELECT vendor_id, purchase_date FROM purchases WHERE id = $1',
        [id],
      );
      if (!ex.rows[0]) return false;

      await client.query(
        `UPDATE purchases SET
           vendor_id     = COALESCE($2, vendor_id),
           bill_no       = COALESCE($3, bill_no),
           purchase_date = COALESCE($4, purchase_date)
         WHERE id = $1`,
        [id, input.vendor_id ?? null, input.bill_no ?? null, input.purchase_date ?? null],
      );

      if (input.items !== undefined) {
        // The vendor tag / movement date reflect the (possibly updated) purchase head.
        const vendorId = input.vendor_id ?? ex.rows[0].vendor_id;
        const movedOn = input.purchase_date ?? ex.rows[0].purchase_date;

        await client.query(
          `DELETE FROM stock_movements WHERE ref_id = $1 AND reason = 'purchase'`,
          [id],
        );
        await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);

        let total = 0;
        for (const it of input.items) {
          const amount = it.amount ?? Number((it.qty * it.rate).toFixed(2));
          total += amount;
          await client.query(
            `INSERT INTO purchase_items (purchase_id, item_id, variant_id, unit, qty, rate, amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, it.item_id, it.variant_id ?? null, it.unit, it.qty, it.rate, amount],
          );
          // Inbound raw-material stock movement, tagged with the source vendor.
          await client.query(
            `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
             VALUES ($1,$2,$3,$4,'purchase',$5,$6, COALESCE($7, CURRENT_DATE))`,
            [it.item_id, it.variant_id ?? null, it.unit, it.qty, id, vendorId, movedOn],
          );
        }

        await client.query(`UPDATE purchases SET total_amount = $2 WHERE id = $1`, [id, total]);
      }

      return true;
    });
  },
};
