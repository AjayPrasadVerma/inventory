import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
import { productsRepo } from './products.repo.js';

export const productsRouter = Router();
productsRouter.use(requireAuth);

const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  category: z.string().trim().optional().nullable(),
  low_stock_qty: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  // A variant is a size and a design, and the edit form sends them apart. A bare
  // string is still accepted: that is what older callers send, and what a variant
  // created before 010 split the columns actually is.
  variants: z.array(z.union([
    z.string().trim().min(1),
    z.object({
      size: z.string().trim().max(60).optional().nullable(),
      design: z.string().trim().max(60).optional().nullable(),
    }).refine((v) => !!((v.size ?? '').trim() || (v.design ?? '').trim()),
      { message: 'A variant needs a size or a design' }),
  ])).default([]),
  // Optional one-time opening stock (onboarding). Ignored on update.
  opening: z.array(z.object({
    variant: z.string().trim().min(1).nullable(),
    qty: z.coerce.number().positive().max(1_000_000),
  })).max(200).optional(),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  sort: z.enum(['name', 'category', 'created_at']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await productsRepo.list({
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

// Lightweight picker options for the sale/job forms (id, name, variants).
productsRouter.get('/options', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await productsRepo.options() });
}));

productsRouter.get('/meta/categories', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await productsRepo.distinctCategories() });
}));

productsRouter.get(
  '/:id/stock',
  asyncHandler(async (req, res) => {
    const data = await productsRepo.stockAccount(parseId(req.params.id));
    if (!data) throw new AppError(404, 'Product not found');
    res.json({ data });
  }),
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await productsRepo.findById(parseId(req.params.id));
    if (!product) throw new AppError(404, 'Product not found');
    res.json({ data: product });
  }),
);

productsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = productSchema.parse(req.body);
    res.status(201).json({ data: await productsRepo.create(input) });
  }),
);

productsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = productSchema.parse(req.body);
    const updated = await productsRepo.update(parseId(req.params.id), input);
    if (!updated) throw new AppError(404, 'Product not found');
    res.json({ data: updated });
  }),
);

productsRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await productsRepo.softDelete(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Product not found');
    res.json({ ok: true });
  }),
);
