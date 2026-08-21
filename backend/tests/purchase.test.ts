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
