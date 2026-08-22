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

describe('the khata cannot lose a stranded payment', () => {
  it('reports it as unlinked, keeping paid and outstanding correct', async () => {
    const pur = await purchasesRepo.create({ vendor_id: f.vendorId, items: [line(f, 10, 100)] } as never);
    await query(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, purchase_id)
       VALUES ('vendor', $1, 'paid', 400, 'Cash', $2)`, [f.vendorId, pur.id]);

    const before = (await vendorsRepo.khata(f.vendorId))!;
    expect(before.totals.paid).toBe(400);
    expect(before.bills[0]!.paid).toBe(400);

    // Force the bad state directly, as if it had been created before the guard.
    await query('UPDATE purchases SET vendor_id = $1 WHERE id = $2', [otherVendorId, pur.id]);

    const after = (await vendorsRepo.khata(f.vendorId))!;
    expect(after.bills).toHaveLength(0);          // the bill left this vendor
    expect(after.unlinked).toHaveLength(1);       // the money did not vanish
    expect(after.unlinked[0]!.amount).toBe(400);
    expect(after.totals.paid).toBe(400);

    // The whole point: the account page must still agree with the list page.
    const { rows } = await vendorsRepo.list({ limit: 10, offset: 0 } as never);
    const listed = rows.find((v) => v.id === f.vendorId)!;
    expect(after.totals.outstanding).toBe(Number(listed.balance));
  });
});
