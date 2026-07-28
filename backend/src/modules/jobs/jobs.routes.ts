import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import { jobsRepo } from './jobs.repo.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const issueSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  unit: z.string().trim().min(1).max(30),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
});
const receiptSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
});

const createSchema = z.object({
  karigar_id: z.coerce.number().int().positive(),
  job_date: pastOrTodayDateSchema.optional().nullable(),
  expected_note: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  issues: z.array(issueSchema).min(1, 'Issue at least one material').max(200, 'Too many items'),
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
    }).parse(req.body);
    if (body.receipts.length === 0 && body.returns.length === 0) {
      throw new AppError(400, 'Receive or return at least one item');
    }
    await jobsRepo.addReceipt(id, body.receipts, body.returns, body.on_date);
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
    }).parse(req.body);
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
