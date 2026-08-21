import { query } from '../../config/db.js';

export interface VendorRow {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  gst_no: string | null;
  notes: string | null;
  opening_balance: string;
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
  opening_balance?: number | null;
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

    // Current balance (payable) = opening + purchases − payments(paid).
    const balanceExpr = `
      COALESCE(v.opening_balance, 0)
      + COALESCE((SELECT SUM(p.total_amount) FROM purchases p WHERE p.vendor_id = v.id), 0)
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
      `INSERT INTO vendors (name, phone, address, city, gst_no, notes, opening_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.name, input.phone ?? null, input.address ?? null, input.city ?? null, input.gst_no ?? null, input.notes ?? null, input.opening_balance ?? 0],
    );
    return rows[0]!;
  },

  async update(id: number, input: VendorInput): Promise<VendorRow | null> {
    const { rows } = await query<VendorRow>(
      `UPDATE vendors SET
         name = $2, phone = $3, address = $4, city = $5,
         gst_no = $6, notes = $7, opening_balance = $8, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.name, input.phone ?? null, input.address ?? null, input.city ?? null, input.gst_no ?? null, input.notes ?? null, input.opening_balance ?? 0],
    );
    return rows[0] ?? null;
  },

  async softDelete(id: number): Promise<boolean> {
    const res = await query('UPDATE vendors SET is_active = FALSE, updated_at = now() WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  },

  /** Bill-wise khata: every purchase with the payments made against THAT bill.
   *  Replaces the old flat two-list ledger — the account page pairs each bill with
   *  its own payments, so "which bill was this payment for?" is answerable.
   *  `unlinked` holds vouchers with no purchase attached (older or on-account money);
   *  they still reduce what the vendor is owed, so they are never hidden. */
  async khata(id: number): Promise<{
    opening: number;
    bills: {
      id: number;
      date: string;
      bill_no: string | null;
      total: number;
      items: { name: string; color: string | null; unit: string; qty: string; kind: 'item' | 'product' }[];
      payments: { id: number; date: string; method: string | null; amount: number; advance: boolean }[];
      paid: number;
      remaining: number;
    }[];
    unlinked: { id: number; date: string; method: string | null; amount: number; note: string | null }[];
    totals: { purchases: number; paid: number; outstanding: number };
  } | null> {
    const vendor = await this.findById(id);
    if (!vendor) return null;

    const purchases = (await query<{ id: number; purchase_date: string; bill_no: string | null; total_amount: string; amount_paid: string }>(
      `SELECT id, purchase_date, bill_no, total_amount, amount_paid
       FROM purchases WHERE vendor_id = $1
       ORDER BY purchase_date DESC, id DESC`,
      [id],
    )).rows;

    const payments = (await query<{
      id: number; pay_date: string; amount: string; method: string | null;
      ref_note: string | null; purchase_id: number | null;
    }>(
      `SELECT id, pay_date, amount, method, ref_note, purchase_id
       FROM payments
       WHERE party_type = 'vendor' AND party_id = $1 AND direction = 'paid'
       ORDER BY pay_date, id`,
      [id],
    )).rows;

    const itemRows = (await query<{ purchase_id: number; name: string; color: string | null; unit: string; qty: string; kind: 'item' | 'product' }>(
      // LEFT JOINs on both sides — a bought-in finished product is a valid line too.
      `SELECT pi.purchase_id,
              COALESCE(i.name, pr.name) AS name,
              COALESCE(iv.color, pv.variant) AS color,
              pi.unit, pi.qty,
              CASE WHEN pi.product_id IS NOT NULL THEN 'product' ELSE 'item' END AS kind
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id
       LEFT JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants iv ON iv.id = pi.variant_id
       LEFT JOIN products pr ON pr.id = pi.product_id
       LEFT JOIN product_variants pv ON pv.id = pi.product_variant_id
       WHERE p.vendor_id = $1
       ORDER BY pi.id`,
      [id],
    )).rows;

    const itemsBy = new Map<number, { name: string; color: string | null; unit: string; qty: string; kind: 'item' | 'product' }[]>();
    for (const r of itemRows) {
      const list = itemsBy.get(r.purchase_id) ?? [];
      list.push({ name: r.name, color: r.color, unit: r.unit, qty: r.qty, kind: r.kind });
      itemsBy.set(r.purchase_id, list);
    }

    const paysBy = new Map<number, typeof payments>();
    const unlinked: { id: number; date: string; method: string | null; amount: number; note: string | null }[] = [];
    for (const pay of payments) {
      if (pay.purchase_id == null) {
        unlinked.push({ id: pay.id, date: pay.pay_date, method: pay.method, amount: Number(pay.amount), note: pay.ref_note });
        continue;
      }
      const list = paysBy.get(pay.purchase_id) ?? [];
      list.push(pay);
      paysBy.set(pay.purchase_id, list);
    }

    const bills = purchases.map((p) => {
      const total = Number(p.total_amount);
      const advance = Number(p.amount_paid);
      const lines: { id: number; date: string; method: string | null; amount: number; advance: boolean }[] = [];
      // An advance entered with the purchase itself is money paid on that date too,
      // so it belongs in the same list — flagged so the UI can label it.
      if (advance > 0) lines.push({ id: 0, date: p.purchase_date, method: null, amount: advance, advance: true });
      for (const pay of paysBy.get(p.id) ?? []) {
        lines.push({ id: pay.id, date: pay.pay_date, method: pay.method, amount: Number(pay.amount), advance: false });
      }
      const paid = lines.reduce((n, l) => n + l.amount, 0);
      return {
        id: p.id,
        date: p.purchase_date,
        bill_no: p.bill_no,
        total,
        items: itemsBy.get(p.id) ?? [],
        payments: lines,
        paid,
        remaining: total - paid,
      };
    });

    const opening = Number(vendor.opening_balance) || 0;
    const purchaseTotal = bills.reduce((n, b) => n + b.total, 0);
    const paidTotal = bills.reduce((n, b) => n + b.paid, 0) + unlinked.reduce((n, u) => n + u.amount, 0);

    return {
      opening,
      bills,
      unlinked,
      totals: { purchases: purchaseTotal, paid: paidTotal, outstanding: opening + purchaseTotal - paidTotal },
    };
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
      // LEFT JOINs over both catalogues: a line is either a raw material or a
      // bought-in finished product, so an inner join drops one kind entirely and
      // the material table stops reconciling with its own total.
      `SELECT COALESCE(i.name, pr.name) AS name,
              COALESCE(iv.color, pv.variant) AS color,
              pi.unit, SUM(pi.qty) AS qty, SUM(pi.amount) AS amount
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
       LEFT JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_variants iv ON iv.id = pi.variant_id
       LEFT JOIN products pr ON pr.id = pi.product_id
       LEFT JOIN product_variants pv ON pv.id = pi.product_variant_id
       WHERE p.vendor_id = $1
       GROUP BY COALESCE(i.name, pr.name), COALESCE(iv.color, pv.variant), pi.unit
       ORDER BY 1, 2`,
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
