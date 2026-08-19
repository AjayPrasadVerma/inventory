import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
import { karigarsRepo } from './karigars.repo.js';

export const karigarsRouter = Router();
karigarsRouter.use(requireAuth);

const karigarSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().optional().nullable(),
  product_types: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().optional().nullable(),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  productType: z.string().trim().optional(),
  sort: z.enum(['name', 'created_at']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

karigarsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await karigarsRepo.list({
      search: q.search,
      productType: q.productType,
      sort: q.sort,
      dir: q.dir,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

karigarsRouter.get(
  '/options',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ data: await karigarsRepo.options() });
  }),
);

karigarsRouter.get(
  '/meta/summary',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ data: await karigarsRepo.summary() });
  }),
);

karigarsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const karigar = await karigarsRepo.findById(parseId(req.params.id));
    if (!karigar) throw new AppError(404, 'Karigar not found');
    res.json({ data: karigar });
  }),
);

karigarsRouter.get(
  '/:id/ledger',
  asyncHandler(async (req, res) => {
    const ledger = await karigarsRepo.khata(parseId(req.params.id));
    if (!ledger) throw new AppError(404, 'Karigar not found');
    res.json({ data: ledger });
  }),
);

karigarsRouter.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const history = await karigarsRepo.history(parseId(req.params.id));
    if (!history) throw new AppError(404, 'Karigar not found');
    res.json({ data: history });
  }),
);

karigarsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = karigarSchema.parse(req.body);
    res.status(201).json({ data: await karigarsRepo.create(input) });
  }),
);

karigarsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = karigarSchema.parse(req.body);
    const updated = await karigarsRepo.update(parseId(req.params.id), input);
    if (!updated) throw new AppError(404, 'Karigar not found');
    res.json({ data: updated });
  }),
);

karigarsRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await karigarsRepo.softDelete(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Karigar not found');
    res.json({ ok: true });
  }),
);
