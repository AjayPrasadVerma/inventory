import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
import { customersRepo } from './customers.repo.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

// Lookup by mobile — used by the Sale form to auto-fill an existing customer.
customersRouter.get(
  '/lookup',
  asyncHandler(async (req, res) => {
    const mobile = String(req.query.mobile ?? '').trim();
    if (!mobile) return res.json({ data: null });
    res.json({ data: await customersRepo.lookup(mobile) });
  }),
);

// Lightweight picker options for account page (no balance math).
customersRouter.get('/options', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await customersRepo.options() });
}));

const listSchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await customersRepo.list({
      search: q.search,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

customersRouter.get(
  '/:id/ledger',
  asyncHandler(async (req, res) => {
    const ledger = await customersRepo.ledger(parseId(req.params.id));
    if (!ledger) throw new AppError(404, 'Customer not found');
    res.json({ data: ledger });
  }),
);
