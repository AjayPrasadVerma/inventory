import { query } from '../../config/db.js';

export interface VendorRow {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  gst_no: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  gst_no?: string | null;
  notes?: string | null;
}

const SORTABLE: Record<string, string> = {
  name: 'name',
  city: 'city',
  created_at: 'created_at',
};

export const vendorsRepo = {
  /** Lightweight picker options — id/name/phone/city, no balance subqueries. */
  async options(): Promise<{ id: number; name: string; phone: string | null; city: string | null }[]> {
    const { rows } = await query<{ id: number; name: string; phone: string | null; city: string | null }>(
      `SELECT id, name, phone, city FROM vendors WHERE is_active = TRUE ORDER BY name`,
    );
    return rows;
  },

  async list(opts: {
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit: number;
    offset: number;
  }): Promise<{ rows: (VendorRow & { balance: string })[]; total: number }> {
    const where: string[] = ['is_active = TRUE'];
    const params: unknown[] = [];

    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      where.push(`(name ILIKE ${p} OR phone ILIKE ${p} OR city ILIKE ${p})`);
    }

    const sortCol = SORTABLE[opts.sort ?? 'name'] ?? 'name';
    const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Current balance (payable) = purchases − payments(paid).
    const balanceExpr = `
      COALESCE((SELECT SUM(p.total_amount) FROM purchases p WHERE p.vendor_id = v.id), 0)
      - COALESCE((SELECT SUM(p.amount_paid) FROM purchases p WHERE p.vendor_id = v.id), 0)
      - COALESCE((SELECT SUM(pay.amount) FROM payments pay
                  WHERE pay.party_type = 'vendor' AND pay.party_id = v.id AND pay.direction = 'paid'), 0)
    `;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM vendors v ${whereSql}`,
      params,
    );

    const limitP = `$${params.length + 1}`;
    const offsetP = `$${params.length + 2}`;
    const rowsRes = await query<VendorRow & { balance: string }>(
      `SELECT v.*, (${balanceExpr}) AS balance
       FROM vendors v ${whereSql}
       ORDER BY ${sortCol} ${dir}
       LIMIT ${limitP} OFFSET ${offsetP}`,
      [...params, opts.limit, opts.offset],
    );

    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number): Promise<VendorRow | null> {
    const { rows } = await query<VendorRow>('SELECT * FROM vendors WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async create(input: VendorInput): Promise<VendorRow> {
    const { rows } = await query<VendorRow>(
      `INSERT INTO vendors (name, phone, address, city, gst_no, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.name, input.phone ?? null, input.address ?? null, input.city ?? null, input.gst_no ?? null, input.notes ?? null],
    );
    return rows[0]!;
  },

  async update(id: number, input: VendorInput): Promise<VendorRow | null> {
    const { rows } = await query<VendorRow>(
      `UPDATE vendors SET
         name = $2, phone = $3, address = $4, city = $5,
         gst_no = $6, notes = $7, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.name, input.phone ?? null, input.address ?? null, input.city ?? null, input.gst_no ?? null, input.notes ?? null],
    );
    return rows[0] ?? null;
  },

  async softDelete(id: number): Promise<boolean> {
    const res = await query('UPDATE vendors SET is_active = FALSE, updated_at = now() WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  },

  /** Ledger: opening balance, then purchases (credit) and payments (debit), with running balance.
   *  Purchase entries also carry the list of materials bought so the UI can show WHAT was purchased. */
  async ledger(id: number): Promise<{
    entries: {
      date: string;
      type: 'purchase' | 'payment';
      ref: string;
      credit: number;
      debit: number;
      items?: { name: string; color: string | null; unit: string; qty: string }[];
    }[];
  } | null> {
    const vendor = await this.findById(id);
    if (!vendor) return null;

    const purchases = await query<{ purchase_date: string; id: number; total_amount: string; amount_paid: string; bill_no: string | null }>(
      `SELECT id, purchase_date, total_amount, amount_paid, bill_no
       FROM purchases WHERE vendor_id = $1`,
      [id],
    );
    const payments = await query<{ pay_date: string; id: number; amount: string; ref_note: string | null }>(
      `SELECT id, pay_date, amount, ref_note FROM payments
       WHERE party_type = 'vendor' AND party_id = $1 AND direction = 'paid'`,
      [id],
    );

    // Line items for every purchase of this vendor, grouped by purchase id.
    const itemRows = await query<{ purchase_id: number; name: string; color: string | null; unit: string; qty: string }>(
      `SELECT pi.purchase_id, i.name, iv.color, pi.unit, pi.qty
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id
       JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants iv ON iv.id = pi.variant_id
       WHERE p.vendor_id = $1
       ORDER BY pi.id`,
      [id],
    );
    const itemsByPurchase = new Map<number, { name: string; color: string | null; unit: string; qty: string }[]>();
    for (const r of itemRows.rows) {
      const list = itemsByPurchase.get(r.purchase_id) ?? [];
      list.push({ name: r.name, color: r.color, unit: r.unit, qty: r.qty });
      itemsByPurchase.set(r.purchase_id, list);
    }

    const entries: { date: string; type: 'purchase' | 'payment'; ref: string; credit: number; debit: number; items?: { name: string; color: string | null; unit: string; qty: string }[] }[] = [];
    for (const p of purchases.rows) {
      entries.push({
        date: p.purchase_date,
        type: 'purchase',
        ref: p.bill_no ? `Bill ${p.bill_no}` : `Purchase #${p.id}`,
        credit: Number(p.total_amount),
        debit: Number(p.amount_paid),
        items: itemsByPurchase.get(p.id) ?? [],
      });
    }
    for (const pay of payments.rows) {
      entries.push({
        date: pay.pay_date,
        type: 'payment',
        ref: pay.ref_note ?? `Payment #${pay.id}`,
        credit: 0,
        debit: Number(pay.amount),
      });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return { entries };
  },

  /** Full purchase history for a vendor: all purchases + aggregated material received. */
  async history(id: number) {
    const vendor = await this.findById(id);
    if (!vendor) return null;

    const purchases = (await query<{ id: number; purchase_date: string; bill_no: string | null; total_amount: string; amount_paid: string; item_lines: number }>(
      `SELECT p.id, p.purchase_date, p.bill_no, p.total_amount, p.amount_paid,
              COALESCE((SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id), 0)::int AS item_lines
       FROM purchases p WHERE p.vendor_id = $1 ORDER BY p.purchase_date DESC, p.id DESC`,
      [id],
    )).rows;

    const materials = (await query<{ name: string; color: string | null; unit: string; qty: string; amount: string }>(
      `SELECT i.name, iv.color, pi.unit, SUM(pi.qty) AS qty, SUM(pi.amount) AS amount
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
       JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants iv ON iv.id = pi.variant_id
       WHERE p.vendor_id = $1
       GROUP BY i.name, iv.color, pi.unit ORDER BY i.name, iv.color`,
      [id],
    )).rows;

    const totalAmount = purchases.reduce((s, p) => s + Number(p.total_amount), 0);
    const totalPaid = purchases.reduce((s, p) => s + Number(p.amount_paid), 0);

    return {
      name: vendor.name,
      stats: [
        { label: 'Total Purchases', value: purchases.length },
        { label: 'Total Amount', value: totalAmount, money: true },
        { label: 'Paid', value: totalPaid, money: true },
      ],
      tables: [
        {
          title: 'Purchases',
          columns: [
            { label: 'Date', type: 'date' }, { label: 'Bill', type: 'text' },
            { label: 'Items', type: 'text' }, { label: 'Amount', type: 'money' }, { label: 'Paid', type: 'money' },
          ],
          rows: purchases.map((p) => [p.purchase_date, p.bill_no, `${p.item_lines} item(s)`, p.total_amount, p.amount_paid]),
        },
        {
          title: 'Material received (total)',
          columns: [
            { label: 'Material', type: 'text' }, { label: 'Colour', type: 'text' },
            { label: 'Unit', type: 'text' }, { label: 'Qty', type: 'qty' }, { label: 'Amount', type: 'money' },
          ],
          rows: materials.map((m) => [m.name, m.color, m.unit, m.qty, m.amount]),
        },
      ],
    };
  },
};
