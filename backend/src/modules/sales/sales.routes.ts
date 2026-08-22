/**
 * ⚠️  UNUSED — SALE / CUSTOMER MODULE, NOT PART OF THE CURRENT SCOPE
 *
 * The app is inventory-only right now. Sale and Customers are hidden from the
 * menu (see components/app-shell.tsx) and the owner has said no work is to be
 * done here. This file is kept, not deleted, so billing can be switched back on
 * later without rebuilding it — the routes, tables and data are all intact.
 *
 * Do not extend, refactor or "tidy" this file. If a change here looks necessary,
 * ask first: it almost certainly means something outside the module is wrong.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import { salesRepo } from './sales.repo.js';

export const salesRouter = Router();
salesRouter.use(requireAuth);

const itemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
  price: z.coerce.number().min(0).max(1_000_000_000).default(0),
});

const createSchema = z.object({
  mobile: z.string().trim().max(20).optional().nullable(),
  customer_name: z.string().trim().max(200).optional().nullable(),
  type: z.enum(['retail', 'wholesale']).default('retail'),
  sale_date: pastOrTodayDateSchema.optional().nullable(),
  payment_mode: z.enum(['cash', 'credit']).default('cash'),
  amount_received: z.coerce.number().min(0).max(1_000_000_000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Add at least one product').max(200, 'Too many items'),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  type: z.enum(['retail', 'wholesale']).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await salesRepo.list({
      search: q.search,
      type: q.type,
      from: q.from,
      to: q.to,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const sale = await salesRepo.findById(parseId(req.params.id));
    if (!sale) throw new AppError(404, 'Sale not found');
    res.json({ data: sale });
  }),
);

salesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const created = await salesRepo.create({ ...input, created_by: req.user?.id ?? null });
    res.status(201).json({ data: created });
  }),
);

const editSchema = z.object({
  type: z.enum(['retail', 'wholesale']).optional(),
  sale_date: pastOrTodayDateSchema.optional(),
  items: z
    .array(
      z.object({
        product_id: z.coerce.number().int().positive(),
        variant_id: z.coerce.number().int().positive().nullable().optional(),
        qty: z.coerce.number().positive().max(1_000_000),
        price: z.coerce.number().min(0).max(1_000_000_000),
      }),
    )
    .max(200, 'Too many items')
    .optional(),
});

salesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = editSchema.parse(req.body);
    const ok = await salesRepo.editRow(parseId(req.params.id), body);
    if (!ok) throw new AppError(404, 'Sale not found');
    res.json({ data: await salesRepo.findById(parseId(req.params.id)) });
  }),
);

salesRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ok = await salesRepo.deleteRow(parseId(req.params.id));
    if (!ok) throw new AppError(404, 'Sale not found');
    res.json({ ok: true });
  }),
);
