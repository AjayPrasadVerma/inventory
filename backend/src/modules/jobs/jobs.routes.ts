import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import { assertCatalogueLines } from '../../utils/catalogue.js';
import { jobsRepo } from './jobs.repo.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

/** Raw-material line → its colour and unit must both belong to that item. */
const issueLine = (l: { item_id: number; variant_id?: number | null; unit: string }) =>
  ({ kind: 'item' as const, id: l.item_id, variant_id: l.variant_id ?? null, unit: l.unit });
/** Finished-goods line → only the variant is checked; products have no unit catalogue. */
const receiptLine = (l: { product_id: number; variant_id?: number | null }) =>
  ({ kind: 'product' as const, id: l.product_id, variant_id: l.variant_id ?? null });

const issueSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  issued_on: pastOrTodayDateSchema.optional().nullable(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  unit: z.string().trim().min(1).max(30),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
});
const receiptSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  received_on: pastOrTodayDateSchema.optional().nullable(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
});

/** Money paid to the karigar as part of an issue/receive step — linked to that job. */
const jobPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  method: z.string().trim().max(30).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

const createSchema = z.object({
  karigar_id: z.coerce.number().int().positive(),
  job_date: pastOrTodayDateSchema.optional().nullable(),
  expected_note: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  issues: z.array(issueSchema).min(1, 'Issue at least one material').max(200, 'Too many items'),
  payment: jobPaymentSchema.optional().nullable(),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  karigarId: z.coerce.number().int().positive().optional(),
  status: z.enum(['open', 'closed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await jobsRepo.list({
      search: q.search,
      karigarId: q.karigarId,
      status: q.status,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

jobsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const job = await jobsRepo.findById(parseId(req.params.id));
    if (!job) throw new AppError(404, 'Job not found');
    res.json({ data: job });
  }),
);

jobsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    await assertCatalogueLines(input.issues.map(issueLine));
    const created = await jobsRepo.create({ ...input, created_by: req.user?.id ?? null });
    res.status(201).json({ data: created });
  }),
);

jobsRouter.post(
  '/:id/issue',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await jobsRepo.exists(id))) throw new AppError(404, 'Job not found');
    const body = z.object({
      issues: z.array(issueSchema).min(1).max(200, 'Too many items'),
      on_date: pastOrTodayDateSchema.optional().nullable(),
    }).parse(req.body);
    await assertCatalogueLines(body.issues.map(issueLine));
    await jobsRepo.addIssues(id, body.issues, body.on_date);
    res.json({ ok: true });
  }),
);

jobsRouter.post(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await jobsRepo.exists(id))) throw new AppError(404, 'Job not found');
    const body = z.object({
      receipts: z.array(receiptSchema).max(200, 'Too many items').default([]),
      returns: z.array(issueSchema).max(200, 'Too many items').default([]),
      on_date: pastOrTodayDateSchema.optional().nullable(),
      payment: jobPaymentSchema.optional().nullable(),
    }).parse(req.body);
    if (body.receipts.length === 0 && body.returns.length === 0 && !body.payment) {
      throw new AppError(400, 'Receive or return at least one item, or record a payment');
    }
    await jobsRepo.addReceipt(id, body.receipts, body.returns, body.on_date, body.payment ?? null);
    res.json({ ok: true });
  }),
);

jobsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = z.object({
      status: z.enum(['open', 'closed']).optional(),
      notes: z.string().trim().max(2000).optional().nullable(),
      job_date: pastOrTodayDateSchema.optional(),
      expected_note: z.string().trim().max(2000).optional().nullable(),
      issues: z.array(issueSchema).max(200, 'Too many items').optional(),
      receipts: z.array(receiptSchema).max(200, 'Too many items').optional(),
      returns: z.array(issueSchema).max(200, 'Too many items').optional(),
    }).parse(req.body);
    await assertCatalogueLines([
      ...(body.issues ?? []).map(issueLine),
      ...(body.returns ?? []).map(issueLine),
      ...(body.receipts ?? []).map(receiptLine),
    ]);
    const ok = await jobsRepo.editJob(id, body);
    if (!ok) throw new AppError(404, 'Job not found');
    res.json({ ok: true });
  }),
);

jobsRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await jobsRepo.deleteJob(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Job not found');
    res.json({ ok: true });
  }),
);
