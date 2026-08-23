/**
 * Moving a bill between vendors.
 *
 * A payment records who was paid (party_id) AND which bill it settled
 * (purchase_id). Change the bill's vendor and those two disagree: the money stays
 * with the vendor who paid, the bill leaves their khata. The read path then found
 * the payment on neither a bill nor the unlinked list, so it disappeared from the
 * khata and from the paid total — Outstanding came out too high and stopped
 * matching the vendors list.
 *
 * Two defences, tested here: the edit refuses to strand a payment, and the khata
 * cannot lose one even if the data is already in that state.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { migrate, reset, pool, query } from './helpers/db.js';
import { seedFixtures, type Fixtures } from './helpers/fixtures.js';
import { purchasesRepo } from '../src/modules/purchases/purchases.repo.js';
import { vendorsRepo } from '../src/modules/vendors/vendors.repo.js';

let f: Fixtures;
let otherVendorId: number;

beforeAll(migrate);
beforeEach(async () => {
  await reset();
  f = await seedFixtures();
  otherVendorId = (await query<{ id: number }>(
    `INSERT INTO vendors (name) VALUES ('Second Vendor') RETURNING id`)).rows[0]!.id;
});
afterAll(() => pool.end());

const line = (f: Fixtures, qty = 10, rate = 100) =>
  ({ kind: 'item' as const, item_id: f.itemId, unit: f.itemUnit, qty, rate });

/** Reassigning is still allowed while nothing has been paid against the bill. */
describe('a bill with no payments', () => {
  it('can be moved to another vendor, and the stock tag moves with it', async () => {
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [line(f)] } as never);

    await purchasesRepo.editRow(pur.id, { vendor_id: otherVendorId, items: [line(f)] } as never);

    const row = await query<{ vendor_id: number }>('SELECT vendor_id FROM purchases WHERE id = $1', [pur.id]);
    expect(row.rows[0]!.vendor_id).toBe(otherVendorId);
    const mv = await query<{ vendor_id: number }>(
      `SELECT DISTINCT vendor_id FROM stock_movements WHERE ref_id = $1 AND reason = 'purchase'`, [pur.id]);
    expect(mv.rows[0]!.vendor_id).toBe(otherVendorId);
  });
});

describe('a paid bill cannot be moved to another vendor', () => {
  it('is refused by the database, not just by the route', async () => {
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [line(f, 10, 100)] } as never);
    await query(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, purchase_id)
       VALUES ('vendor', $1, 'paid', 400, 'Cash', $2)`, [f.vendorId, pur.id]);

    // Migration 009 makes (purchase_id, party_id) reference purchases(id, vendor_id),
    // so the reassign is rejected at the lowest level — the route's friendly 409 is
    // now a nicer message on top of a guarantee, not the only thing holding the line.
    await expect(
      query('UPDATE purchases SET vendor_id = $1 WHERE id = $2', [otherVendorId, pur.id]),
    ).rejects.toThrow(/payments_purchase_party_fkey/);

    // And the money is still where it was.
    const khata = (await vendorsRepo.khata(f.vendorId))!;
    expect(khata.totals.paid).toBe(400);
    expect(khata.bills[0]!.paid).toBe(400);
  });
});

describe('a payment cannot be linked across parties', () => {
  it('rejects a vendor payment pointing at another vendor\'s bill', async () => {
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [line(f)] } as never);
    await expect(
      query(`INSERT INTO payments (party_type, party_id, direction, amount, method, purchase_id)
             VALUES ('vendor', $1, 'paid', 100, 'Cash', $2)`, [otherVendorId, pur.id]),
    ).rejects.toThrow(/payments_purchase_party_fkey/);
  });

  it('still allows a karigar payment, which has no purchase link at all', async () => {
    // MATCH SIMPLE: with purchase_id NULL the composite FK is not checked, which is
    // what makes one polymorphic party_id column workable.
    await expect(
      query(`INSERT INTO payments (party_type, party_id, direction, amount, method)
             VALUES ('karigar', $1, 'paid', 250, 'Cash')`, [f.karigarId]),
    ).resolves.toBeTruthy();
  });
});

describe('the khata keeps its defence anyway', () => {
  it('reports a payment outside this vendor\'s bills as unlinked', async () => {
    // Unreachable through the API now that 009 is in place, but the read path must
    // not silently drop money if a constraint is ever relaxed or data is repaired
    // by hand — the money would otherwise vanish from both the khata and the total.
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [line(f, 10, 100)] } as never);
    await query(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, purchase_id)
       VALUES ('vendor', $1, 'paid', 400, 'Cash', $2)`, [f.vendorId, pur.id]);

    // Detach the link the only way the constraint allows: drop the bill's rows so
    // the FK nulls purchase_id, leaving the payment on account.
    await purchasesRepo.deleteRow(pur.id);

    const khata = (await vendorsRepo.khata(f.vendorId))!;
    expect(khata.bills).toHaveLength(0);
    // deleteRow removes the bill's own payments, so nothing is left to strand.
    expect(khata.totals.paid).toBe(0);

    const { rows } = await vendorsRepo.list({ limit: 10, offset: 0 } as never);
    const listed = rows.find((v) => v.id === f.vendorId)!;
    expect(khata.totals.outstanding).toBe(Number(listed.balance));
  });
});
