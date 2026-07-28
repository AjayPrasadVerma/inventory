import { query, withTransaction } from '../../config/db.js';

export interface JobIssueInput {
  item_id: number;
  variant_id?: number | null;
  unit: string;
  qty: number;
}
export interface JobReceiptInput {
  product_id: number;
  variant_id?: number | null;
  qty: number;
}
export interface JobReturnInput {
  item_id: number;
  variant_id?: number | null;
  unit: string;
  qty: number;
}

export interface JobCreateInput {
  karigar_id: number;
  job_date?: string | null;
  expected_note?: string | null;
  notes?: string | null;
  issues: JobIssueInput[];
  created_by?: number | null;
}

export interface JobListRow {
  id: number;
  karigar_id: number;
  karigar_name: string;
  job_date: string;
  expected_note: string | null;
  status: 'open' | 'closed';
  issue_lines: number;
  received_qty: string;
  created_at: string;
}

export const jobsRepo = {
  async create(input: JobCreateInput): Promise<{ id: number }> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO jobs (karigar_id, job_date, expected_note, notes, created_by)
         VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5) RETURNING id`,
        [
          input.karigar_id,
          input.job_date ?? null,
          input.expected_note ?? null,
          input.notes ?? null,
          input.created_by ?? null,
        ],
      );
      const jobId = rows[0]!.id;
      await insertIssues(client, jobId, input.issues, input.job_date ?? null);
      return { id: jobId };
    });
  },

  /** Add more raw material to an existing (open) job. */
  async addIssues(jobId: number, issues: JobIssueInput[], onDate?: string | null): Promise<void> {
    await withTransaction(async (client) => {
      await insertIssues(client, jobId, issues, onDate ?? null);
    });
  },

  /** Receive finished goods (in) and optionally return leftover material (in). */
  async addReceipt(
    jobId: number,
    receipts: JobReceiptInput[],
    returns: JobReturnInput[],
    onDate?: string | null,
  ): Promise<void> {
    await withTransaction(async (client) => {
      for (const r of receipts) {
        await client.query(
          `INSERT INTO job_receipts (job_id, product_id, variant_id, qty, received_on)
           VALUES ($1,$2,$3,$4, COALESCE($5, CURRENT_DATE))`,
          [jobId, r.product_id, r.variant_id ?? null, r.qty, onDate ?? null],
        );
        await client.query(
          `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
           VALUES ($1,$2,$3,'job_receipt',$4, COALESCE($5, CURRENT_DATE))`,
          [r.product_id, r.variant_id ?? null, r.qty, jobId, onDate ?? null],
        );
      }
      for (const ret of returns) {
        await client.query(
          `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
           VALUES ($1,$2,$3,$4,'job_return',$5,NULL, COALESCE($6, CURRENT_DATE))`,
          [ret.item_id, ret.variant_id ?? null, ret.unit, ret.qty, jobId, onDate ?? null],
        );
      }
    });
  },

  async setFields(
    jobId: number,
    fields: {
      status?: 'open' | 'closed';
      notes?: string | null;
      job_date?: string | null;
      expected_note?: string | null;
    },
  ): Promise<boolean> {
    const res = await query(
      `UPDATE jobs SET
         status        = COALESCE($2, status),
         notes         = COALESCE($3, notes),
         job_date      = COALESCE($4, job_date),
         expected_note = COALESCE($5, expected_note)
       WHERE id = $1`,
      [
        jobId,
        fields.status ?? null,
        fields.notes ?? null,
        fields.job_date ?? null,
        fields.expected_note ?? null,
      ],
    );
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * Edit a job in a single transaction: update basic fields and optionally
   * REPLACE issued materials and/or received goods, reversing + re-applying
   * their stock movements. `issues`/`receipts` undefined = leave untouched;
   * an empty array = remove all (the deletes accomplish the removal).
   */
  async editJob(
    jobId: number,
    fields: {
      job_date?: string | null;
      expected_note?: string | null;
      status?: 'open' | 'closed';
      notes?: string | null;
      issues?: JobIssueInput[];
      receipts?: JobReceiptInput[];
    },
  ): Promise<boolean> {
    return withTransaction(async (client) => {
      const ex = await client.query('SELECT id FROM jobs WHERE id=$1', [jobId]);
      if (!ex.rows[0]) return false;

      await client.query(
        `UPDATE jobs SET
           status        = COALESCE($2, status),
           notes         = COALESCE($3, notes),
           job_date      = COALESCE($4, job_date),
           expected_note = COALESCE($5, expected_note)
         WHERE id = $1`,
        [
          jobId,
          fields.status ?? null,
          fields.notes ?? null,
          fields.job_date ?? null,
          fields.expected_note ?? null,
        ],
      );

      if (fields.issues !== undefined) {
        await client.query(
          `DELETE FROM stock_movements WHERE ref_id = $1 AND reason = 'job_issue'`,
          [jobId],
        );
        await client.query(`DELETE FROM job_issues WHERE job_id = $1`, [jobId]);
        await insertIssues(client, jobId, fields.issues, fields.job_date ?? null);
      }

      if (fields.receipts !== undefined) {
        await client.query(
          `DELETE FROM finished_stock_movements WHERE ref_id = $1 AND reason = 'job_receipt'`,
          [jobId],
        );
        await client.query(`DELETE FROM job_receipts WHERE job_id = $1`, [jobId]);
        for (const r of fields.receipts) {
          await client.query(
            `INSERT INTO job_receipts (job_id, product_id, variant_id, qty, received_on)
             VALUES ($1,$2,$3,$4, COALESCE($5, CURRENT_DATE))`,
            [jobId, r.product_id, r.variant_id ?? null, r.qty, fields.job_date ?? null],
          );
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
             VALUES ($1,$2,$3,'job_receipt',$4, COALESCE($5, CURRENT_DATE))`,
            [r.product_id, r.variant_id ?? null, r.qty, jobId, fields.job_date ?? null],
          );
        }
      }

      return true;
    });
  },

  /** Fully delete a job and reverse all its stock effects (owner-only at route level). */
  async deleteJob(id: number): Promise<boolean> {
    return withTransaction(async (client) => {
      await client.query(
        `DELETE FROM stock_movements WHERE ref_id = $1 AND reason IN ('job_issue','job_return')`,
        [id],
      );
      await client.query(
        `DELETE FROM finished_stock_movements WHERE ref_id = $1 AND reason = 'job_receipt'`,
        [id],
      );
      await client.query(`DELETE FROM job_receipts WHERE job_id = $1`, [id]);
      await client.query(`DELETE FROM job_issues WHERE job_id = $1`, [id]);
      const res = await client.query(`DELETE FROM jobs WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    });
  },

  async list(opts: {
    search?: string;
    karigarId?: number;
    status?: 'open' | 'closed';
    limit: number;
    offset: number;
  }): Promise<{ rows: JobListRow[]; total: number }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      where.push(`(k.name ILIKE ${p} OR j.expected_note ILIKE ${p})`);
    }
    if (opts.karigarId) {
      params.push(opts.karigarId);
      where.push(`j.karigar_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`j.status = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM jobs j JOIN karigars k ON k.id = j.karigar_id ${whereSql}`,
      params,
    );
    const rowsRes = await query<JobListRow>(
      `SELECT j.id, j.karigar_id, k.name AS karigar_name, j.job_date, j.expected_note,
              j.status, j.created_at,
              COALESCE((SELECT COUNT(*) FROM job_issues ji WHERE ji.job_id = j.id), 0)::int AS issue_lines,
              COALESCE((SELECT SUM(qty) FROM job_receipts jr WHERE jr.job_id = j.id), 0) AS received_qty
       FROM jobs j JOIN karigars k ON k.id = j.karigar_id ${whereSql}
       ORDER BY j.job_date DESC, j.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  },

  async findById(id: number) {
    const head = await query<JobListRow & { notes: string | null; karigar_phone: string | null }>(
      `SELECT j.id, j.karigar_id, k.name AS karigar_name, k.phone AS karigar_phone,
              j.job_date, j.expected_note, j.status, j.notes, j.created_at
       FROM jobs j JOIN karigars k ON k.id = j.karigar_id WHERE j.id = $1`,
      [id],
    );
    if (!head.rows[0]) return null;

    const issues = await query(
      `SELECT ji.id, ji.item_id, i.name AS item_name, ji.variant_id, iv.color,
              ji.unit, ji.qty, ji.issued_on
       FROM job_issues ji
       JOIN items i ON i.id = ji.item_id
       LEFT JOIN item_variants iv ON iv.id = ji.variant_id
       WHERE ji.job_id = $1 ORDER BY ji.id`,
      [id],
    );
    const receipts = await query(
      `SELECT jr.id, jr.product_id, p.name AS product_name, jr.variant_id, pv.variant,
              jr.qty, jr.received_on
       FROM job_receipts jr
       JOIN products p ON p.id = jr.product_id
       LEFT JOIN product_variants pv ON pv.id = jr.variant_id
       WHERE jr.job_id = $1 ORDER BY jr.id`,
      [id],
    );
    const returns = await query(
      `SELECT sm.id, sm.item_id, i.name AS item_name, sm.variant_id, iv.color,
              sm.unit, sm.qty, sm.moved_on
       FROM stock_movements sm
       JOIN items i ON i.id = sm.item_id
       LEFT JOIN item_variants iv ON iv.id = sm.variant_id
       WHERE sm.reason = 'job_return' AND sm.ref_id = $1 ORDER BY sm.id`,
      [id],
    );
    return { ...head.rows[0], issues: issues.rows, receipts: receipts.rows, returns: returns.rows };
  },

  async exists(id: number): Promise<boolean> {
    const { rows } = await query<{ id: number }>('SELECT id FROM jobs WHERE id = $1', [id]);
    return rows.length > 0;
  },
};

async function insertIssues(
  client: import('pg').PoolClient,
  jobId: number,
  issues: JobIssueInput[],
  onDate: string | null,
) {
  for (const it of issues) {
    await client.query(
      `INSERT INTO job_issues (job_id, item_id, variant_id, unit, qty, issued_on)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6, CURRENT_DATE))`,
      [jobId, it.item_id, it.variant_id ?? null, it.unit, it.qty, onDate],
    );
    // Raw material leaves stock (negative movement).
    await client.query(
      `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
       VALUES ($1,$2,$3,$4,'job_issue',$5,NULL, COALESCE($6, CURRENT_DATE))`,
      [it.item_id, it.variant_id ?? null, it.unit, -Math.abs(it.qty), jobId, onDate],
    );
  }
}
