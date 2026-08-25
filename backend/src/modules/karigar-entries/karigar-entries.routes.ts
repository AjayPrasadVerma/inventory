import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import { karigarEntriesRepo } from './karigar-entries.repo.js';

export const karigarEntriesRouter = Router();
karigarEntriesRouter.use(requireAuth);

/**
 * A line names its catalogue entry by text. There is deliberately no id: the
 * owner types a name and the repo resolves it, creating the row when it is new,
 * because the alternative was making them go and build a product on another
 * screen before they could record what already physically happened.
 */
const lineSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(200),
  size: z.string().trim().max(60).optional().nullable(),
  design: z.string().trim().max(60).optional().nullable(),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
});

const createSchema = z.object({
  direction: z.enum(['in', 'out']),
  entry_date: pastOrTodayDateSchema.optional().nullable(),
  remark: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one line').max(200, 'Too many lines'),
  advance: z
    .object({
      amount: z.coerce.number().positive().max(1_000_000_000),
      method: z.string().trim().max(30).optional().nullable(),
    })
    .optional()
    .nullable(),
});

const logSchema = z.object({
  from: pastOrTodayDateSchema.optional().nullable(),
  to: pastOrTodayDateSchema.optional().nullable(),
  search: z.string().trim().max(200).optional(),
});

karigarEntriesRouter.get(
  '/:karigarId/entries',
  asyncHandler(async (req, res) => {
    const karigarId = parseId(req.params.karigarId);
    const q = logSchema.parse(req.query);
    const data = await karigarEntriesRepo.log(karigarId, {
      from: q.from ?? null,
      to: q.to ?? null,
      search: q.search ?? null,
    });
    res.json({ data });
  }),
);

karigarEntriesRouter.post(
  '/:karigarId/entries',
  asyncHandler(async (req, res) => {
    const karigarId = parseId(req.params.karigarId);
    const input = createSchema.parse(req.body);
    const { id } = await karigarEntriesRepo.create({
      karigar_id: karigarId,
      direction: input.direction,
      entry_date: input.entry_date ?? null,
      remark: input.remark ?? null,
      lines: input.lines,
      advance: input.advance ?? null,
      created_by: req.user?.id ?? null,
    });
    res.status(201).json({ data: { id } });
  }),
);

karigarEntriesRouter.delete(
  '/:karigarId/entries/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const karigarId = parseId(req.params.karigarId);
    const id = parseId(req.params.id);
    // Scoped to the karigar in the path, so a stray id cannot delete another
    // karigar's entry.
    const ok = await karigarEntriesRepo.remove(karigarId, id);
    if (!ok) throw new AppError(404, 'Entry not found');
    res.json({ ok: true });
  }),
);

karigarEntriesRouter.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const q = z
      .object({ direction: z.enum(['in', 'out']), q: z.string().trim().max(200).default('') })
      .parse(req.query);
    const data = await karigarEntriesRepo.suggest(q.direction, q.q);
    res.json({ data });
  }),
);
