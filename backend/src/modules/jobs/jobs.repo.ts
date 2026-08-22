import { query, withTransaction } from '../../config/db.js';
import { likeTerm } from '../../utils/sql.js';

export interface JobIssueInput {
  /** The day this line actually left stock. Preserved across an edit so restating
   *  a line does not backdate (or forward-date) the movement. */
  issued_on?: string | null;
  item_id: number;
  variant_id?: number | null;
  unit: string;
  qty: number;
}
export interface JobReceiptInput {
  /** The day these goods actually came back. See JobIssueInput.issued_on. */
  received_on?: string | null;
  product_id: number;
  variant_id?: number | null;
  qty: number;
}
export interface JobReturnInput {
  /** The day this material actually came back. See JobIssueInput.issued_on. */
  returned_on?: string | null;
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
  /** Advance handed over while issuing the material. */
  payment?: { amount: number; method?: string | null; on_date?: string | null; note?: string | null } | null;
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

/** Money handed to the karigar as part of this job step. Written inside the caller's
 *  transaction so a failed stock insert can never leave an orphan payment behind. */
async function insertJobPayment(
  client: { query: (q: string, v?: unknown[]) => Promise<unknown> },
  jobId: number,
  karigarId: number,
  pay: { amount: number; method?: string | null; on_date?: string | null; note?: string | null },
): Promise<void> {
  if (!(pay.amount > 0)) return;
  await client.query(
    `INSERT INTO payments (party_type, party_id, direction, amount, method, pay_date, ref_note, job_id)
     VALUES ('karigar', $1, 'paid', $2, COALESCE($3,'cash'), COALESCE($4, CURRENT_DATE), $5, $6)`,
    [karigarId, pay.amount, pay.method ?? null, pay.on_date ?? null, pay.note ?? null, jobId],
  );
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
      if (input.payment) {
        await insertJobPayment(client, jobId, input.karigar_id, {
          ...input.payment,
          on_date: input.payment.on_date ?? input.job_date ?? null,
        });
      }
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
    payment?: { amount: number; method?: string | null; note?: string | null } | null,
  ): Promise<void> {
    await withTransaction(async (client) => {
      for (const r of receipts) {
        await client.query(
          `INSERT INTO job_receipts (job_id, product_id, variant_id, qty, received_on)
           VALUES ($1,$2,$3,$4, COALESCE($5, CURRENT_DATE))`,
          [jobId, r.product_id, r.variant_id ?? null, r.qty, r.received_on ?? onDate ?? null],
        );
        await client.query(
          `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
           VALUES ($1,$2,$3,'job_receipt',$4, COALESCE($5, CURRENT_DATE))`,
          [r.product_id, r.variant_id ?? null, r.qty, jobId, r.received_on ?? onDate ?? null],
        );
      }
      await insertReturns(client, jobId, returns, onDate ?? null);
      if (payment && payment.amount > 0) {
        const owner = await client.query<{ karigar_id: number }>('SELECT karigar_id FROM jobs WHERE id = $1', [jobId]);
        const karigarId = owner.rows[0]?.karigar_id;
        if (karigarId) await insertJobPayment(client, jobId, karigarId, { ...payment, on_date: onDate ?? null });
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
      returns?: JobReturnInput[];
    },
  ): Promise<boolean> {
    return withTransaction(async (client) => {
      const ex = await client.query('SELECT id FROM jobs WHERE id=$1', [jobId]);
      if (!ex.rows[0]) return false;

      // Build the SET list from only the fields the caller actually sent. COALESCE
      // cannot tell "not provided" from "set this to null", so it made the nullable
      // free-text columns impossible to clear: the UI reported success and kept the
      // old value. Column names come from the literals below, never from the request.
      const sets: string[] = [];
      const vals: unknown[] = [jobId];
      const put = (col: string, value: unknown) => {
        vals.push(value);
        sets.push(`${col} = $${vals.length}`);
      };
      // NOT NULL columns: only ever assigned a real value.
      if (fields.status != null) put('status', fields.status);
      if (fields.job_date != null) put('job_date', fields.job_date);
      // Nullable free text: an explicit null clears it.
      if (fields.notes !== undefined) put('notes', fields.notes);
      if (fields.expected_note !== undefined) put('expected_note', fields.expected_note);
      if (sets.length > 0) {
        await client.query(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $1`, vals);
      }

      // A job's raw material moves in two directions — issued out, and unused
      // stock returned — and both are stock_movements on this job. Replacing the
      // issues while a job_return survives credits material that was never
      // issued, so the pair is replaced as a unit (same reasons deleteJob clears).
      if (fields.issues !== undefined) {
        await client.query(
          `DELETE FROM stock_movements WHERE ref_id = $1 AND reason IN ('job_issue','job_return')`,
          [jobId],
        );
        await client.query(`DELETE FROM job_issues WHERE job_id = $1`, [jobId]);
        await insertIssues(client, jobId, fields.issues, fields.job_date ?? null);
        await insertReturns(client, jobId, fields.returns ?? [], fields.job_date ?? null);
      } else if (fields.returns !== undefined) {
        await client.query(
          `DELETE FROM stock_movements WHERE ref_id = $1 AND reason = 'job_return'`,
          [jobId],
        );
        await insertReturns(client, jobId, fields.returns, fields.job_date ?? null);
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
            // The line's own date, NOT job_date: an edit must not move the day the
            // goods came back (and with job_date absent this fell through to today).
            [jobId, r.product_id, r.variant_id ?? null, r.qty, r.received_on ?? null],
          );
          await client.query(
            `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
             VALUES ($1,$2,$3,'job_receipt',$4, COALESCE($5, CURRENT_DATE))`,
            [r.product_id, r.variant_id ?? null, r.qty, jobId, r.received_on ?? null],
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
      // Money paid for this job goes with it, so the karigar's total paid is
      // reversed too. (The FK is ON DELETE SET NULL, which would otherwise leave
      // these behind as untraceable on-account payments.)
      await client.query(`DELETE FROM payments WHERE job_id = $1`, [id]);
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
      params.push(likeTerm(opts.search));
      const p = `$${params.length}`;
      where.push(`(k.name ILIKE ${p} ESCAPE '\\' OR j.expected_note ILIKE ${p} ESCAPE '\\')`);
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

/** Unused raw material coming back from a job — a positive movement, tagged job_return. */
async function insertReturns(
  client: import('pg').PoolClient,
  jobId: number,
  returns: JobReturnInput[],
  onDate: string | null,
) {
  for (const ret of returns) {
    await client.query(
      `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
       VALUES ($1,$2,$3,$4,'job_return',$5,NULL, COALESCE($6, CURRENT_DATE))`,
      [ret.item_id, ret.variant_id ?? null, ret.unit, Math.abs(ret.qty), jobId, ret.returned_on ?? onDate],
    );
  }
}

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
      [jobId, it.item_id, it.variant_id ?? null, it.unit, it.qty, it.issued_on ?? onDate],
    );
    // Raw material leaves stock (negative movement).
    await client.query(
      `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
       VALUES ($1,$2,$3,$4,'job_issue',$5,NULL, COALESCE($6, CURRENT_DATE))`,
      [it.item_id, it.variant_id ?? null, it.unit, -Math.abs(it.qty), jobId, it.issued_on ?? onDate],
    );
  }
}
