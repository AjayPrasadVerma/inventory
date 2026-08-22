import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';
import { catalogueRepo } from './catalogue.repo.js';

export const catalogueRouter = Router();
catalogueRouter.use(requireAuth);

const listSchema = z.object({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  kind: z.enum(['item', 'product']).optional(),
  sort: z.enum(['name', 'category', 'kind']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

/** Raw materials and finished products in one list, each tagged with its kind. */
catalogueRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await catalogueRepo.list({
      search: q.search,
      category: q.category,
      kind: q.kind,
      sort: q.sort,
      dir: q.dir,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

catalogueRouter.get(
  '/meta/categories',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ data: await catalogueRepo.categories() });
  }),
);
