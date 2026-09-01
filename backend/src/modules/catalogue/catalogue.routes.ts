import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import {
  addCatalogueLines, catalogueRepo, convertCatalogueKind, editCatalogueFromSheet,
} from './catalogue.repo.js';

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

/**
 * A catalogue line as the sheet sends it: a typed name, and the size and design
 * beside it. Quantity is optional — a thing can be stocked before any of it is
 * in hand — but when present it books the opening stock in the same call, because
 * the owner does not think of creating the row and saying how much there is as
 * two separate acts.
 */
/** Editing sends the same shape, plus which record it is. Quantity here means
 *  "make the stock this" — see editCatalogueFromSheet. */
/** Which catalogue the path is addressing. */
const kindParam = z.enum(['item', 'product']);

const editSheetSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  on_date: pastOrTodayDateSchema.optional().nullable(),
  lines: z.array(z.object({
    size: z.string().trim().max(60).optional().nullable(),
    design: z.string().trim().max(60).optional().nullable(),
    qty: z.coerce.number().min(-1_000_000).max(1_000_000).optional().nullable(),
  })).max(200, 'Too many lines'),
});

const bulkSchema = z.object({
  kind: z.enum(['item', 'product']),
  on_date: pastOrTodayDateSchema.optional().nullable(),
  lines: z.array(z.object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    size: z.string().trim().max(60).optional().nullable(),
    design: z.string().trim().max(60).optional().nullable(),
    qty: z.coerce.number().nonnegative().max(1_000_000).optional().nullable(),
  })).min(1, 'Add at least one line').max(200, 'Too many lines'),
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


catalogueRouter.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const input = bulkSchema.parse(req.body);
    const out = await addCatalogueLines({ ...input, created_by: req.user?.id ?? null });
    res.status(201).json({ data: out });
  }),
);

catalogueRouter.put(
  '/:kind/:id/sheet',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const kind = kindParam.parse(req.params.kind);
    const input = editSheetSchema.parse(req.body);
    const out = await editCatalogueFromSheet({ ...input, kind, id: parseId(req.params.id) });
    res.json({ data: out });
  }),
);

catalogueRouter.put(
  '/:kind/:id/convert',
  // Owner-only: this is the one route here that deletes rather than hides, and
  // it takes a record's whole stock ledger with it.
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const input = z.object({
      on_date: pastOrTodayDateSchema.optional().nullable(),
      // The rest of the edit rides along so the move and the edit commit or fail
      // together. Same line shape as the sheet route.
      sheet: z.object({
        name: z.string().trim().min(1).max(200),
        lines: editSheetSchema.shape.lines,
      }).optional().nullable(),
    }).parse(req.body);
    const out = await convertCatalogueKind({
      ...input, from: kindParam.parse(req.params.kind), id: parseId(req.params.id),
    });
    res.json({ data: out });
  }),
);

catalogueRouter.get(
  '/meta/categories',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ data: await catalogueRepo.categories() });
  }),
);
