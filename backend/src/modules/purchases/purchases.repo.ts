import { query, withTransaction } from '../../config/db.js';

/**
 * One purchase line. `kind` decides which side of stock it lands on:
 * a raw material goes to stock_movements, a bought-in finished product goes to
 * finished_stock_movements with reason 'purchase'. The DB enforces that exactly
 * one of item_id / product_id is set.
 */
export interface PurchaseItemInput {
  kind?: 'item' | 'product';
  item_id?: number | null;
  product_id?: number | null;
  variant_id?: number | null;
  unit: string;
  qty: number;
  rate: number;
  amount?: number;
}

/** Which table a line belongs to — defaults to raw material for older callers. */
function lineKind(it: PurchaseItemInput): 'item' | 'product' {
  return it.kind ?? (it.product_id != null ? 'product' : 'item');
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
  kind: 'item' | 'product';
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

/** Write one purchase line plus its inbound stock movement, on the correct side. */
async function insertLine(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  purchaseId: number,
  vendorId: number,
  movedOn: string | null,
  it: PurchaseItemInput,
): Promise<void> {
  const amount = it.amount ?? Number((it.qty * it.rate).toFixed(2));

  if (lineKind(it) === 'product') {
    await client.query(
      `INSERT INTO purchase_items (purchase_id, product_id, product_variant_id, unit, qty, rate, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [purchaseId, it.product_id, it.variant_id ?? null, it.unit, it.qty, it.rate, amount],
    );
    // Bought-in finished goods land in finished stock, tagged with the source vendor.
    await client.query(
      `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, vendor_id, moved_on)
       VALUES ($1,$2,$3,'purchase',$4,$5, COALESCE($6, CURRENT_DATE))`,
      [it.product_id, it.variant_id ?? null, it.qty, purchaseId, vendorId, movedOn],
    );
    return;
  }

  await client.query(
    `INSERT INTO purchase_items (purchase_id, item_id, variant_id, unit, qty, rate, amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [purchaseId, it.item_id, it.variant_id ?? null, it.unit, it.qty, it.rate, amount],
  );
  await client.query(
    `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
     VALUES ($1,$2,$3,$4,'purchase',$5,$6, COALESCE($7, CURRENT_DATE))`,
    [it.item_id, it.variant_id ?? null, it.unit, it.qty, purchaseId, vendorId, movedOn],
  );
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
        await insertLine(client, purchaseId, input.vendor_id, input.purchase_date ?? null, it);
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
        // LEFT JOINs on both sides — an inner join on items would silently drop
        // finished-product lines.
        `SELECT pi.purchase_id,
                COALESCE(i.name, pr.name) AS name,
                COALESCE(iv.color, pv.variant) AS color,
                pi.unit, pi.qty,
                CASE WHEN pi.product_id IS NOT NULL THEN 'product' ELSE 'item' END AS kind
         FROM purchase_items pi
         LEFT JOIN items i ON i.id = pi.item_id
         LEFT JOIN item_variants iv ON iv.id = pi.variant_id
         LEFT JOIN products pr ON pr.id = pi.product_id
         LEFT JOIN product_variants pv ON pv.id = pi.product_variant_id
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
      `SELECT pi.id,
              CASE WHEN pi.product_id IS NOT NULL THEN 'product' ELSE 'item' END AS kind,
              pi.item_id, pi.product_id,
              COALESCE(pi.variant_id, pi.product_variant_id) AS variant_id,
              COALESCE(i.name, pr.name) AS item_name,
              COALESCE(iv.color, pv.variant) AS color,
              pi.unit, pi.qty, pi.rate, pi.amount
       FROM purchase_items pi
       LEFT JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants iv ON iv.id = pi.variant_id
       LEFT JOIN products pr ON pr.id = pi.product_id
       LEFT JOIN product_variants pv ON pv.id = pi.product_variant_id
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
      await client.query(
        `DELETE FROM finished_stock_movements WHERE ref_id = $1 AND reason = 'purchase'`,
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

        // Both sides are reversed — a line's kind may have changed on edit.
        await client.query(
          `DELETE FROM stock_movements WHERE ref_id = $1 AND reason = 'purchase'`,
          [id],
        );
        await client.query(
          `DELETE FROM finished_stock_movements WHERE ref_id = $1 AND reason = 'purchase'`,
          [id],
        );
        await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);

        let total = 0;
        for (const it of input.items) {
          total += it.amount ?? Number((it.qty * it.rate).toFixed(2));
          await insertLine(client, id, vendorId, movedOn, it);
        }

        await client.query(`UPDATE purchases SET total_amount = $2 WHERE id = $1`, [id, total]);
      }

      return true;
    });
  },
};
