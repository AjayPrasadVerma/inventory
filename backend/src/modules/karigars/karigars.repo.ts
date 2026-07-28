import { query } from '../../config/db.js';

export interface KarigarRow {
  id: number;
  name: string;
  phone: string | null;
  product_types: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KarigarInput {
  name: string;
  phone?: string | null;
  product_types?: string[];
  notes?: string | null;
}

const SORTABLE: Record<string, string> = { name: 'name', created_at: 'created_at' };

export const karigarsRepo = {
  async list(opts: {
    search?: string;
    productType?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit: number;
    offset: number;
  }): Promise<{ rows: (KarigarRow & { total_paid: string })[]; total: number }> {
    const where: string[] = ['is_active = TRUE'];
    const params: unknown[] = [];

    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      where.push(`(name ILIKE ${p} OR phone ILIKE ${p})`);
    }
    if (opts.productType) {
      params.push(opts.productType);
      where.push(`$${params.length} = ANY(product_types)`);
    }

    const sortCol = SORTABLE[opts.sort ?? 'name'] ?? 'name';
    const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Total paid = sum of payments made to this karigar.
    const totalPaidExpr = `
      COALESCE((SELECT SUM(pay.amount) FROM payments pay
                WHERE pay.party_type = 'karigar' AND pay.party_id = k.id AND pay.direction = 'paid'), 0)
    `;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM karigars k ${whereSql}`,
      params,
    );
    const rowsRes = await query<KarigarRow & { total_paid: string }>(
      `SELECT k.*, (${totalPaidExpr}) AS total_paid FROM karigars k ${whereSql}
       ORDER BY ${sortCol} ${dir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  /** Lightweight picker options — id/name/phone, no total_paid subquery. */
  async options(): Promise<{ id: number; name: string; phone: string | null }[]> {
    const { rows } = await query<{ id: number; name: string; phone: string | null }>(
      `SELECT id, name, phone FROM karigars WHERE is_active = TRUE ORDER BY name`,
    );
    return rows;
  },

  /** Filter options + headline total for the list page (kept correct under pagination). */
  async summary(): Promise<{ productTypes: string[]; totalPaid: number }> {
    const pt = await query<{ t: string }>(
      `SELECT DISTINCT unnest(product_types) AS t FROM karigars WHERE is_active = TRUE ORDER BY t`,
    );
    const tp = await query<{ sum: string }>(
      `SELECT COALESCE(SUM(amount),0) AS sum FROM payments WHERE party_type = 'karigar' AND direction = 'paid'`,
    );
    return {
      productTypes: pt.rows.map((r) => r.t).filter(Boolean),
      totalPaid: Number(tp.rows[0]?.sum ?? 0),
    };
  },

  async findById(id: number): Promise<KarigarRow | null> {
    const { rows } = await query<KarigarRow>('SELECT * FROM karigars WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async create(input: KarigarInput): Promise<KarigarRow> {
    const { rows } = await query<KarigarRow>(
      `INSERT INTO karigars (name, phone, product_types, notes)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.name, input.phone ?? null, input.product_types ?? [], input.notes ?? null],
    );
    return rows[0]!;
  },

  async update(id: number, input: KarigarInput): Promise<KarigarRow | null> {
    const { rows } = await query<KarigarRow>(
      `UPDATE karigars SET name=$2, phone=$3, product_types=$4, notes=$5, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, input.name, input.phone ?? null, input.product_types ?? [], input.notes ?? null],
    );
    return rows[0] ?? null;
  },

  async softDelete(id: number): Promise<boolean> {
    const res = await query('UPDATE karigars SET is_active=FALSE, updated_at=now() WHERE id=$1', [id]);
    return (res.rowCount ?? 0) > 0;
  },

  /** Ledger: jobs (with finished goods received) and payments made, plus total paid.
   *  Job entries carry the finished goods RECEIVED for that job so the UI can show WHAT was produced. */
  async ledger(id: number): Promise<{
    totalPaid: number;
    entries: {
      date: string;
      type: 'job' | 'payment';
      ref: string;
      paid: number;
      items?: { name: string; variant: string | null; qty: string }[];
    }[];
  } | null> {
    const karigar = await this.findById(id);
    if (!karigar) return null;

    const jobs = await query<{ job_date: string; id: number }>(
      `SELECT id, job_date FROM jobs WHERE karigar_id = $1`,
      [id],
    );
    const payments = await query<{ pay_date: string; id: number; amount: string; ref_note: string | null }>(
      `SELECT id, pay_date, amount, ref_note FROM payments
       WHERE party_type = 'karigar' AND party_id = $1 AND direction = 'paid'`,
      [id],
    );

    // Finished goods received for every job of this karigar, grouped by job id.
    const receiptRows = await query<{ job_id: number; name: string; variant: string | null; qty: string }>(
      `SELECT jr.job_id, p.name, pv.variant, jr.qty
       FROM job_receipts jr
       JOIN jobs j ON j.id = jr.job_id
       JOIN products p ON p.id = jr.product_id
       LEFT JOIN product_variants pv ON pv.id = jr.variant_id
       WHERE j.karigar_id = $1
       ORDER BY jr.id`,
      [id],
    );
    const itemsByJob = new Map<number, { name: string; variant: string | null; qty: string }[]>();
    for (const r of receiptRows.rows) {
      const list = itemsByJob.get(r.job_id) ?? [];
      list.push({ name: r.name, variant: r.variant, qty: r.qty });
      itemsByJob.set(r.job_id, list);
    }

    const entries: { date: string; type: 'job' | 'payment'; ref: string; paid: number; items?: { name: string; variant: string | null; qty: string }[] }[] = [];
    for (const j of jobs.rows) {
      entries.push({ date: j.job_date, type: 'job', ref: `Job #${j.id}`, paid: 0, items: itemsByJob.get(j.id) ?? [] });
    }
    let totalPaid = 0;
    for (const pay of payments.rows) {
      const amt = Number(pay.amount);
      totalPaid += amt;
      entries.push({ date: pay.pay_date, type: 'payment', ref: pay.ref_note ?? `Payment #${pay.id}`, paid: amt });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { totalPaid, entries };
  },

  /** Full work history for a karigar: all jobs + aggregated material given vs goods received. */
  async history(id: number) {
    const karigar = await this.findById(id);
    if (!karigar) return null;

    const jobs = (await query<{ id: number; job_date: string; expected_note: string | null; labour_amount: string; status: string; issue_lines: number; received_qty: string }>(
      `SELECT j.id, j.job_date, j.expected_note, j.labour_amount, j.status,
              COALESCE((SELECT COUNT(*) FROM job_issues ji WHERE ji.job_id = j.id), 0)::int AS issue_lines,
              COALESCE((SELECT SUM(qty) FROM job_receipts jr WHERE jr.job_id = j.id), 0) AS received_qty
       FROM jobs j WHERE j.karigar_id = $1 ORDER BY j.job_date DESC, j.id DESC`,
      [id],
    )).rows;

    const materials = (await query<{ name: string; color: string | null; unit: string; qty: string }>(
      `SELECT i.name, iv.color, ji.unit, SUM(ji.qty) AS qty
       FROM job_issues ji JOIN jobs j ON j.id = ji.job_id
       JOIN items i ON i.id = ji.item_id
       LEFT JOIN item_variants iv ON iv.id = ji.variant_id
       WHERE j.karigar_id = $1
       GROUP BY i.name, iv.color, ji.unit ORDER BY i.name, iv.color`,
      [id],
    )).rows;

    const products = (await query<{ name: string; variant: string | null; qty: string }>(
      `SELECT p.name, pv.variant, SUM(jr.qty) AS qty
       FROM job_receipts jr JOIN jobs j ON j.id = jr.job_id
       JOIN products p ON p.id = jr.product_id
       LEFT JOIN product_variants pv ON pv.id = jr.variant_id
       WHERE j.karigar_id = $1
       GROUP BY p.name, pv.variant ORDER BY p.name, pv.variant`,
      [id],
    )).rows;

    const totalLabour = jobs.reduce((s, j) => s + Number(j.labour_amount), 0);
    const totalReceived = products.reduce((s, p) => s + Number(p.qty), 0);

    return {
      name: karigar.name,
      stats: [
        { label: 'Total Jobs', value: jobs.length },
        { label: 'Total Labour', value: totalLabour, money: true },
        { label: 'Goods Received', value: totalReceived },
      ],
      tables: [
        {
          title: 'Jobs',
          columns: [
            { label: 'Date', type: 'date' }, { label: 'Work', type: 'text' },
            { label: 'Issued', type: 'text' }, { label: 'Received', type: 'qty' },
            { label: 'Labour', type: 'money' }, { label: 'Status', type: 'text' },
          ],
          rows: jobs.map((j) => [j.job_date, j.expected_note, `${j.issue_lines} item(s)`, j.received_qty, j.labour_amount, j.status]),
        },
        {
          title: 'Material given (total)',
          columns: [
            { label: 'Material', type: 'text' }, { label: 'Colour', type: 'text' },
            { label: 'Unit', type: 'text' }, { label: 'Qty', type: 'qty' },
          ],
          rows: materials.map((m) => [m.name, m.color, m.unit, m.qty]),
        },
        {
          title: 'Goods received (total)',
          columns: [
            { label: 'Product', type: 'text' }, { label: 'Variant', type: 'text' }, { label: 'Qty', type: 'qty' },
          ],
          rows: products.map((p) => [p.name, p.variant, p.qty]),
        },
      ],
    };
  },
};
