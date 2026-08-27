/**
 * Purchase chain. Every case here maps to a defect this codebase actually shipped:
 * an edit path that rejected finished-product lines, inner joins that dropped them
 * from reads, and deletes that left stock or payments behind.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, resetTransactions, pool, query } from './helpers/db.js';
import { seedFixtures, rawOnHand, finishedOnHand, type Fixtures } from './helpers/fixtures.js';
import { purchasesRepo } from '../src/modules/purchases/purchases.repo.js';
import { vendorsRepo } from '../src/modules/vendors/vendors.repo.js';

let f: Fixtures;

// The catalogue is seeded once: truncating tables everything references needs
// heavy locks, and every test only ever writes documents and movements.
beforeAll(async () => {
  await setupSchema();
  f = await seedFixtures();
});
beforeEach(resetTransactions);
afterAll(() => pool.end());

const rawLine = (f: Fixtures, qty = 10, rate = 50) =>
  ({ kind: 'item' as const, item_id: f.itemId, variant_id: f.itemVariantId, unit: f.itemUnit, qty, rate });
const productLine = (f: Fixtures, qty = 5, rate = 200) =>
  ({ kind: 'product' as const, product_id: f.productId, variant_id: f.productVariantId, unit: 'pcs', qty, rate });

describe('purchase of raw material', () => {
  it('adds raw stock and nothing to finished stock', async () => {
    await purchasesRepo.create({ vendor_id: f.vendorId, items: [rawLine(f)] } as never);
    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(10);
    expect(await finishedOnHand(f.productId)).toBe(0);
  });
});

describe('purchase of finished goods', () => {
  it('adds finished stock tagged with the source vendor', async () => {
    await purchasesRepo.create({ vendor_id: f.vendorId, items: [productLine(f)] } as never);
    expect(await finishedOnHand(f.productId)).toBe(5);
    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(0);
    const mv = await query<{ vendor_id: number; reason: string }>(
      `SELECT vendor_id, reason FROM finished_stock_movements WHERE product_id = $1`, [f.productId]);
    expect(mv.rows[0]).toMatchObject({ vendor_id: f.vendorId, reason: 'purchase' });
  });

  it('appears in every read path, both kinds on one bill', async () => {
    await purchasesRepo.create({
      vendor_id: f.vendorId, bill_no: 'B-MIX', items: [rawLine(f), productLine(f)],
    } as never);

    // list — an inner join on items used to drop the product line silently
    const list = await purchasesRepo.list({ limit: 20, offset: 0 } as never);
    const row = list.rows.find((r) => r.bill_no === 'B-MIX')!;
    expect(row.items.map((i) => i.kind).sort()).toEqual(['item', 'product']);

    // vendor khata
    const khata = (await vendorsRepo.khata(f.vendorId))!;
    const bill = khata.bills.find((b) => b.bill_no === 'B-MIX')!;
    expect(bill.items.map((i) => i.kind).sort()).toEqual(['item', 'product']);

    // edit prefill
    const detail = (await purchasesRepo.findById(row.id)) as unknown as {
      items: { kind: string; item_id: number | null; product_id: number | null }[];
    };
    const p = detail.items.find((i) => i.kind === 'product')!;
    expect(p.product_id).toBe(f.productId);
    expect(p.item_id).toBeNull();
  });

  it('rejects a line naming both kinds, or neither', async () => {
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [rawLine(f)] } as never);
    await expect(query(
      `INSERT INTO purchase_items (purchase_id,item_id,product_id,unit,qty,rate,amount) VALUES ($1,$2,$3,'pcs',1,1,1)`,
      [pur.id, f.itemId, f.productId])).rejects.toThrow(/one_kind/);
    await expect(query(
      `INSERT INTO purchase_items (purchase_id,unit,qty,rate,amount) VALUES ($1,'pcs',1,1,1)`,
      [pur.id])).rejects.toThrow(/one_kind/);
  });
});

describe('edit', () => {
  it('can turn a raw line into a product line, leaving no orphan movement', async () => {
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [rawLine(f)] } as never);
    await purchasesRepo.editRow(pur.id, { items: [productLine(f)] } as never);

    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(0);
    expect(await finishedOnHand(f.productId)).toBe(5);
    const raw = await query(`SELECT 1 FROM stock_movements WHERE ref_id = $1 AND reason = 'purchase'`, [pur.id]);
    expect(raw.rowCount).toBe(0);
  });
});

describe('delete', () => {
  it('restores both stock tables and removes payments linked to the bill', async () => {
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId, items: [rawLine(f), productLine(f)],
    } as never);
    await query(
      `INSERT INTO payments (party_type,party_id,direction,amount,method,purchase_id)
       VALUES ('vendor',$1,'paid',400,'Cash',$2)`, [f.vendorId, pur.id]);

    await purchasesRepo.deleteRow(pur.id);

    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(0);
    expect(await finishedOnHand(f.productId)).toBe(0);
    // The FK is ON DELETE SET NULL, so a surviving row would become an
    // untraceable on-account payment rather than disappearing.
    const pay = await query(`SELECT 1 FROM payments WHERE party_id = $1`, [f.vendorId]);
    expect(pay.rowCount).toBe(0);
  });
});

describe('khata invariants', () => {
  it('outstanding equals the vendor list balance', async () => {
    await purchasesRepo.create({ vendor_id: f.vendorId, items: [rawLine(f, 10, 100)] } as never);
    await query(
      `INSERT INTO payments (party_type,party_id,direction,amount,method) VALUES ('vendor',$1,'paid',300,'Cash')`,
      [f.vendorId]);

    const khata = (await vendorsRepo.khata(f.vendorId))!;
    const { rows } = await vendorsRepo.list({ limit: 10, offset: 0 } as never);
    const listed = rows.find((v) => v.id === f.vendorId)!;

    expect(khata.totals.outstanding).toBe(700);
    expect(Number(listed.balance)).toBe(khata.totals.outstanding);
  });

  it('per-bill remaining equals total minus everything paid against it', async () => {
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId, items: [rawLine(f, 10, 100)], amount_paid: 250,
    } as never);
    await query(
      `INSERT INTO payments (party_type,party_id,direction,amount,method,purchase_id)
       VALUES ('vendor',$1,'paid',150,'Cash',$2)`, [f.vendorId, pur.id]);

    const bill = (await vendorsRepo.khata(f.vendorId))!.bills[0]!;
    expect(bill.total).toBe(1000);
    expect(bill.paid).toBe(400);
    expect(bill.remaining).toBe(600);
  });
});

describe('line amount', () => {
  it('is always qty × rate, never what the caller claimed', async () => {
    // `amount` is no longer accepted from the request; a caller that sends one
    // must not be able to make a bill total disagree with its own lines.
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId,
      items: [{ ...rawLine(f, 10, 50), amount: 999_999 } as never],
    } as never);

    const line = await query<{ amount: string }>(
      'SELECT amount FROM purchase_items WHERE purchase_id = $1', [pur.id]);
    const head = await query<{ total_amount: string }>(
      'SELECT total_amount FROM purchases WHERE id = $1', [pur.id]);

    expect(Number(line.rows[0]!.amount)).toBe(500);
    expect(Number(head.rows[0]!.total_amount)).toBe(500);
  });

  it('keeps the bill total equal to the sum of its lines after an edit', async () => {
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId, items: [rawLine(f, 10, 50)],
    } as never);
    await purchasesRepo.editRow(pur.id, {
      items: [rawLine(f, 3, 20), productLine(f, 2, 100)],
    } as never);

    const sum = await query<{ s: string }>(
      'SELECT SUM(amount)::text AS s FROM purchase_items WHERE purchase_id = $1', [pur.id]);
    const head = await query<{ total_amount: string }>(
      'SELECT total_amount FROM purchases WHERE id = $1', [pur.id]);

    expect(Number(sum.rows[0]!.s)).toBe(260);
    expect(Number(head.rows[0]!.total_amount)).toBe(260);
  });
});

describe('typed lines from the sheet', () => {
  const nameCount = async (table: 'items' | 'products', name: string) =>
    Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE lower(name) = lower($1)`, [name])).rows[0]!.n);

  it('creates a raw material that does not exist yet and moves its stock', async () => {
    expect(await nameCount('items', 'Sheet Board')).toBe(0);
    const { id } = await purchasesRepo.create({
      vendor_id: f.vendorId,
      items: [{ name: 'Sheet Board', size: 'sheet', design: 'Grey', qty: 10, rate: 25 }],
    });
    expect(await nameCount('items', 'Sheet Board')).toBe(1);

    const bill = (await purchasesRepo.findById(id))!;
    expect(Number(bill.total_amount)).toBe(250);

    // Size became the unit and design became the colour, so raw stock counts it
    // the same way every other path does.
    const mv = await query<{ unit: string; qty: string; reason: string }>(
      `SELECT sm.unit, sm.qty, sm.reason FROM stock_movements sm
       JOIN items i ON i.id = sm.item_id
       WHERE lower(i.name) = 'sheet board'`);
    expect(mv.rowCount).toBe(1);
    expect(mv.rows[0]!.unit).toBe('sheet');
    expect(Number(mv.rows[0]!.qty)).toBe(10);
    expect(mv.rows[0]!.reason).toBe('purchase');
  });

  it('sends a name already in products to finished stock, not raw', async () => {
    const before = await finishedOnHand(f.productId);
    await purchasesRepo.create({
      vendor_id: f.vendorId,
      items: [{ name: 'Test Ring Box', size: 'Small', qty: 6, rate: 40 }],
    });
    expect(await finishedOnHand(f.productId)).toBe(before + 6);
    // And nothing was created in items under that name.
    expect(await nameCount('items', 'Test Ring Box')).toBe(0);
  });

  it('reuses an existing raw name whatever the case', async () => {
    await purchasesRepo.create({
      vendor_id: f.vendorId,
      items: [{ name: 'test velvet', size: 'meter', design: 'Red', qty: 3, rate: 10 }],
    });
    expect(await nameCount('items', 'Test Velvet')).toBe(1);
  });

  it('derives the total from qty and rate, never from the caller', async () => {
    const { id } = await purchasesRepo.create({
      vendor_id: f.vendorId,
      items: [
        { name: 'Sheet Foam', size: 'sheet', qty: 4, rate: 12.5 },
        { name: 'Sheet Foam', size: 'kilo', qty: 2, rate: 100 },
      ],
    });
    const bill = (await purchasesRepo.findById(id))!;
    expect(Number(bill.total_amount)).toBe(4 * 12.5 + 2 * 100);
  });

  it('leaves no catalogue row behind when the purchase fails', async () => {
    // A negative quantity trips the DB CHECK after the catalogue row would have
    // been created — the transaction has to take it back with everything else.
    await expect(purchasesRepo.create({
      vendor_id: f.vendorId,
      items: [{ name: 'Never Committed', size: 'sheet', qty: -5, rate: 10 }],
    })).rejects.toThrow();
    expect(await nameCount('items', 'Never Committed')).toBe(0);
  });
});
