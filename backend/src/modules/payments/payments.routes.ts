import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { pastOrTodayDateSchema } from '../../utils/validation.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const paymentSchema = z.object({
  party_type: z.enum(['vendor', 'karigar', 'customer']),
  party_id: z.coerce.number().int().positive(),
  direction: z.enum(['paid', 'received']).default('paid'),
  amount: z.coerce.number().positive('Amount must be greater than 0').max(1_000_000_000),
  method: z.string().trim().max(30).default('cash'),
  pay_date: pastOrTodayDateSchema.optional().nullable(),
  ref_note: z.string().trim().max(2000).optional().nullable(),
});

/** The table each party_type lives in — used to confirm the party exists before recording money against it. */
const PARTY_TABLE: Record<'vendor' | 'karigar' | 'customer', string> = {
  vendor: 'vendors',
  karigar: 'karigars',
  customer: 'customers',
};

const listSchema = z.object({
  party_type: z.enum(['vendor', 'karigar', 'customer']).optional(),
  party_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

paymentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (q.party_type) {
      params.push(q.party_type);
      where.push(`party_type = $${params.length}`);
    }
    if (q.party_id) {
      params.push(q.party_id);
      where.push(`party_id = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = await query(
      `SELECT * FROM payments ${whereSql}
       ORDER BY pay_date DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    res.json({ data: rows.rows });
  }),
);

paymentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = paymentSchema.parse(req.body);
    // No FK on payments.party_id (it's polymorphic) — verify the party exists so we
    // never record money against a non-existent vendor/karigar/customer.
    const table = PARTY_TABLE[input.party_type];
    const found = await query(`SELECT 1 FROM ${table} WHERE id = $1`, [input.party_id]);
    if (found.rowCount === 0) throw new AppError(404, `That ${input.party_type} was not found.`);
    const { rows } = await query(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, pay_date, ref_note, created_by)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6, CURRENT_DATE), $7, $8) RETURNING *`,
      [
        input.party_type,
        input.party_id,
        input.direction,
        input.amount,
        input.method,
        input.pay_date ?? null,
        input.ref_note ?? null,
        req.user?.id ?? null,
      ],
    );
    res.status(201).json({ data: rows[0] });
  }),
);
