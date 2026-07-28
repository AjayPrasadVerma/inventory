import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import { purchasesRepo } from './purchases.repo.js';

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth);

const purchaseItemSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  unit: z.string().trim().min(1).max(30),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
  rate: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
  amount: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
});

const purchaseSchema = z.object({
  vendor_id: z.coerce.number().int().positive('Select a vendor'),
  bill_no: z.string().trim().max(60).optional().nullable(),
  purchase_date: pastOrTodayDateSchema.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  amount_paid: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
  items: z.array(purchaseItemSchema).min(1, 'Add at least one item').max(200, 'Too many items'),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  vendorId: z.coerce.number().int().positive().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

purchasesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await purchasesRepo.list({
      search: q.search,
      vendorId: q.vendorId,
      from: q.from,
      to: q.to,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

purchasesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const purchase = await purchasesRepo.findById(parseId(req.params.id));
    if (!purchase) throw new AppError(404, 'Purchase not found');
    res.json({ data: purchase });
  }),
);

purchasesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = purchaseSchema.parse(req.body);
    const created = await purchasesRepo.create({ ...input, created_by: req.user?.id ?? null });
    res.status(201).json({ data: await purchasesRepo.findById(created.id) });
  }),
);

const editSchema = z.object({
  vendor_id: z.coerce.number().int().positive().optional(),
  bill_no: z.string().trim().max(60).optional().nullable(),
  purchase_date: pastOrTodayDateSchema.optional(),
  items: z
    .array(
      z.object({
        item_id: z.coerce.number().int().positive(),
        variant_id: z.coerce.number().int().positive().nullable().optional(),
        unit: z.string().trim().min(1).max(30),
        qty: z.coerce.number().positive().max(1_000_000),
        rate: z.coerce.number().min(0).max(1_000_000_000),
      }),
    )
    .max(200, 'Too many items')
    .optional(),
});

purchasesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = editSchema.parse(req.body);
    const ok = await purchasesRepo.editRow(parseId(req.params.id), body);
    if (!ok) throw new AppError(404, 'Purchase not found');
    res.json({ data: await purchasesRepo.findById(parseId(req.params.id)) });
  }),
);

purchasesRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await purchasesRepo.deleteRow(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Purchase not found');
    res.json({ ok: true });
  }),
);
