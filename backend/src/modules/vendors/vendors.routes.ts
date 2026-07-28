import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
import { vendorsRepo } from './vendors.repo.js';

export const vendorsRouter = Router();
vendorsRouter.use(requireAuth);

const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  gst_no: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  sort: z.enum(['name', 'city', 'created_at']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

vendorsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await vendorsRepo.list({
      search: q.search,
      sort: q.sort,
      dir: q.dir,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

// Lightweight picker options for forms/account pages (no balance math).
vendorsRouter.get('/options', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await vendorsRepo.options() });
}));

vendorsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const vendor = await vendorsRepo.findById(parseId(req.params.id));
    if (!vendor) throw new AppError(404, 'Vendor not found');
    res.json({ data: vendor });
  }),
);

vendorsRouter.get(
  '/:id/ledger',
  asyncHandler(async (req, res) => {
    const ledger = await vendorsRepo.ledger(parseId(req.params.id));
    if (!ledger) throw new AppError(404, 'Vendor not found');
    res.json({ data: ledger });
  }),
);

vendorsRouter.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const history = await vendorsRepo.history(parseId(req.params.id));
    if (!history) throw new AppError(404, 'Vendor not found');
    res.json({ data: history });
  }),
);

vendorsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = vendorSchema.parse(req.body);
    res.status(201).json({ data: await vendorsRepo.create(input) });
  }),
);

vendorsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = vendorSchema.parse(req.body);
    const updated = await vendorsRepo.update(parseId(req.params.id), input);
    if (!updated) throw new AppError(404, 'Vendor not found');
    res.json({ data: updated });
  }),
);

vendorsRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await vendorsRepo.softDelete(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Vendor not found');
    res.json({ ok: true });
  }),
);
