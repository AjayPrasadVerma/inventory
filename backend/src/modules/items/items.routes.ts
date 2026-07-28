import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
import { itemsRepo } from './items.repo.js';

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  category: z.string().trim().optional().nullable(),
  low_stock_qty: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  units: z.array(z.string().trim().min(1)).min(1, 'Kam se kam ek unit'),
  variants: z.array(z.string().trim().min(1)).default([]),
  // Optional one-time opening stock (onboarding). Ignored on update.
  opening: z.array(z.object({
    color: z.string().trim().min(1).nullable(),
    unit: z.string().trim().min(1),
    qty: z.coerce.number().positive().max(1_000_000),
  })).max(500).optional(),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  sort: z.enum(['name', 'category', 'created_at']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

itemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await itemsRepo.list({
      search: q.search,
      category: q.category,
      sort: q.sort,
      dir: q.dir,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

// Lightweight picker options for the purchase/job forms (id, name, units, variants).
itemsRouter.get('/options', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await itemsRepo.options() });
}));

// Autocomplete helpers for the "dynamic" category/unit lists.
itemsRouter.get('/meta/categories', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await itemsRepo.distinctCategories() });
}));
itemsRouter.get('/meta/units', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await itemsRepo.distinctUnits() });
}));

itemsRouter.get(
  '/:id/stock',
  asyncHandler(async (req, res) => {
    const data = await itemsRepo.stockAccount(parseId(req.params.id));
    if (!data) throw new AppError(404, 'Material not found');
    res.json({ data });
  }),
);

itemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await itemsRepo.findById(parseId(req.params.id));
    if (!item) throw new AppError(404, 'Material not found');
    res.json({ data: item });
  }),
);

itemsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body);
    res.status(201).json({ data: await itemsRepo.create(input) });
  }),
);

itemsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body);
    const updated = await itemsRepo.update(parseId(req.params.id), input);
    if (!updated) throw new AppError(404, 'Material not found');
    res.json({ data: updated });
  }),
);

itemsRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await itemsRepo.softDelete(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Material not found');
    res.json({ ok: true });
  }),
);
