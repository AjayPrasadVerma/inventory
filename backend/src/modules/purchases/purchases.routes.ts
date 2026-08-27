import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId, pastOrTodayDateSchema } from '../../utils/validation.js';
import { assertCatalogueLines } from '../../utils/catalogue.js';
import { purchasesRepo, suggestPurchaseNames } from './purchases.repo.js';

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth);

/**
 * A line is either a raw material or a bought-in finished product. `kind` defaults
 * to 'item' so existing callers keep working, and the refinement rejects a line
 * that names neither (or both) before it reaches the DB's CHECK.
 */
const purchaseItemSchema = z.object({
  kind: z.enum(['item', 'product']).optional(),
  item_id: z.coerce.number().int().positive().optional().nullable(),
  product_id: z.coerce.number().int().positive().optional().nullable(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  unit: z.string().trim().min(1).max(30).optional(),
  qty: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
  rate: z.coerce.number().nonnegative().max(1_000_000_000).default(0),

  /** The sheet types a name; the repo resolves it and creates what is new. Size
   *  carries the unit, as it does everywhere the owner types a line. */
  name: z.string().trim().min(1).max(200).optional().nullable(),
  size: z.string().trim().max(60).optional().nullable(),
  design: z.string().trim().max(60).optional().nullable(),
  // No `amount` — it is qty × rate, derived server-side. Accepting it from the
  // client let a caller state a total that did not match its own line.
}).refine(
  (l) => {
    // A typed line carries its own name and needs no ids; an id line still has to
    // name exactly one side, matching its kind.
    if (l.name) return true;
    if (!l.unit) return false;
    const kind = l.kind ?? 'item';
    return kind === 'product'
      ? l.product_id != null && l.item_id == null
      : l.item_id != null && l.product_id == null;
  },
  { message: 'Each line needs either a name, or a unit and exactly one of item_id / product_id matching its kind.' },
);

/** A purchase line reduced to what the catalogue check needs. */
const toCatalogueLine = (l: {
  kind?: 'item' | 'product'; item_id?: number | null; product_id?: number | null;
  variant_id?: number | null; unit?: string;
}) => ({
  kind: l.kind ?? 'item',
  id: ((l.kind ?? 'item') === 'product' ? l.product_id : l.item_id) as number,
  variant_id: l.variant_id ?? null,
  unit: l.unit ?? '',
});

/** Only id lines need checking. A typed line has no ids yet, and the resolver
 *  builds its unit and variant from the same catalogue, so it is consistent by
 *  construction rather than by assertion. */
const idLines = <T extends { name?: string | null }>(lines: T[]) => lines.filter((l) => !l.name);

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
  '/suggest',
  asyncHandler(async (_req, res) => {
    res.json({ data: await suggestPurchaseNames() });
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
    await assertCatalogueLines(idLines(input.items).map(toCatalogueLine));
    const created = await purchasesRepo.create({ ...input, created_by: req.user?.id ?? null });
    res.status(201).json({ data: await purchasesRepo.findById(created.id) });
  }),
);

const editSchema = z.object({
  vendor_id: z.coerce.number().int().positive().optional(),
  bill_no: z.string().trim().max(60).optional().nullable(),
  purchase_date: pastOrTodayDateSchema.optional(),
  // Same line shape as create — otherwise a bill containing a finished-product
  // line cannot be edited at all (the old inline schema required item_id).
  items: z.array(purchaseItemSchema).max(200, 'Too many items').optional(),
});

purchasesRouter.patch(
  '/:id',
  // Editing a bill rewrites stock movements and money, exactly like deleting it,
  // so it carries the same permission as DELETE rather than being open to staff.
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = editSchema.parse(req.body);

    // Moving a bill to a different vendor would strand any payment made against
    // it: the payment stays with the vendor who paid, while the bill leaves their
    // khata, so the money is attached to a bill that is no longer theirs.
    if (body.vendor_id != null) {
      const cur = await query<{ vendor_id: number }>('SELECT vendor_id FROM purchases WHERE id = $1', [id]);
      const currentVendor = cur.rows[0]?.vendor_id;
      if (currentVendor != null && currentVendor !== body.vendor_id) {
        const paid = await query<{ count: string }>(
          `SELECT COUNT(*)::int AS count FROM payments WHERE purchase_id = $1`, [id]);
        if (Number(paid.rows[0]?.count ?? 0) > 0) {
          throw new AppError(
            409,
            'This bill has payments recorded against it, so it cannot be moved to another vendor. '
            + 'Delete the payments first, or delete this bill and enter it under the right vendor.',
          );
        }
      }
    }

    const ok = await purchasesRepo.editRow(id, body);
    if (!ok) throw new AppError(404, 'Purchase not found');
    res.json({ data: await purchasesRepo.findById(id) });
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
