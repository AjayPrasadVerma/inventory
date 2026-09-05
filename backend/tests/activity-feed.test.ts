/**
 * The day feed — `GET /api/reports/activity`, via the repo behind it.
 *
 * What is worth pinning here is the **shape of a line**, because two clients now
 * read it: the website's "Today's activity" and the phone's dashboard.
 *
 * It used to differ by where the line came from. A purchase line carried a real
 * `unit` and a colour in `variant`; a karigar line had its size and design glued
 * together into `variant` with `unit` sent empty. The owner types the unit into
 * the size box — `karigar-entries.repo.ts` says so — so that put the word
 * "meter" where a colour belongs and left every quantity on a karigar entry as a
 * bare number, on the website as much as on the phone.
 *
 * Both now use the same two slots. These tests are here so they cannot drift
 * apart again quietly.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, resetTransactions, pool, query } from './helpers/db.js';
import { seedFixtures, type Fixtures } from './helpers/fixtures.js';
import { karigarEntriesRepo } from '../src/modules/karigar-entries/karigar-entries.repo.js';
import { purchasesRepo } from '../src/modules/purchases/purchases.repo.js';
import { reportsRepo } from '../src/modules/reports/reports.repo.js';

let f: Fixtures;
const DAY = '2026-06-11';

beforeAll(async () => {
  await setupSchema();
  f = await seedFixtures();
});
beforeEach(resetTransactions);
afterAll(async () => {
  await pool.end();
});

const feed = () => reportsRepo.dayActivity(DAY);
const eventOf = async (kind: string) =>
  (await feed()).events.find((e) => e.kind === kind);

describe('a karigar line', () => {
  it('sends the size as the unit and the design as the variant', async () => {
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'out',
      entry_date: DAY,
      remark: 'Lining',
      lines: [{ name: 'Test Velvet', size: 'meter', design: 'Red', qty: 12 }],
    });

    const line = (await eventOf('issue'))!.lines[0]!;
    // The whole point: "meter" is a unit and "Red" is a variant, and neither
    // ends up in the other's field.
    expect(line.unit).toBe('meter');
    expect(line.variant).toBe('Red');
    expect(Number(line.qty)).toBe(12);
  });

  it('leaves the variant null when only a size was typed', async () => {
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'out',
      entry_date: DAY,
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 4 }],
    });

    const line = (await eventOf('issue'))!.lines[0]!;
    expect(line.unit).toBe('meter');
    // Not the empty string, and above all not "meter" repeated into both.
    expect(line.variant).toBeNull();
  });

  it('reads the same way when goods come back in', async () => {
    // IN and OUT are the same form, so they must produce the same shape.
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'in',
      entry_date: DAY,
      lines: [{ name: 'Test Ring Box', size: 'Small', design: 'Plain', qty: 6 }],
    });

    const line = (await eventOf('receipt'))!.lines[0]!;
    expect(line.unit).toBe('Small');
    expect(line.variant).toBe('Plain');
  });
});

describe('a purchase line', () => {
  it('uses the same two fields as a karigar line', async () => {
    await purchasesRepo.create({
      vendor_id: f.vendorId,
      purchase_date: DAY,
      bill_no: 'B-feed-1',
      items: [{ item_id: f.itemId, variant_id: f.itemVariantId, unit: 'meter', qty: 9, rate: 10 }],
    });

    const line = (await eventOf('purchase'))!.lines[0]!;
    expect(line.unit).toBe('meter');
    expect(line.variant).not.toBeNull();
    expect(Number(line.qty)).toBe(9);
  });
});

describe('the day as a whole', () => {
  it('counts each kind and totals what was paid', async () => {
    await purchasesRepo.create({
      vendor_id: f.vendorId,
      purchase_date: DAY,
      items: [{ item_id: f.itemId, variant_id: f.itemVariantId, unit: 'meter', qty: 5, rate: 10 }],
    });
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'out',
      entry_date: DAY,
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 3 }],
    });
    await query(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, pay_date)
       VALUES ('karigar', $1, 'paid', 800, 'cash', $2), ('vendor', $3, 'paid', 200, 'upi', $2)`,
      [f.karigarId, DAY, f.vendorId],
    );

    const day = await feed();
    expect(day.counts.purchases).toBe(1);
    expect(day.counts.issues).toBe(1);
    expect(day.counts.payments).toBe(2);
    expect(day.paid).toBe(1000);
    expect(day.events).toHaveLength(4);
  });

  it('shows nothing for a day nothing happened on', async () => {
    const day = await reportsRepo.dayActivity('2019-01-01');
    expect(day.events).toHaveLength(0);
    expect(day.paid).toBe(0);
  });

  it('keeps a payment out of the goods columns', async () => {
    await query(
      `INSERT INTO payments (party_type, party_id, direction, amount, method, pay_date)
       VALUES ('karigar', $1, 'paid', 500, 'cash', $2)`,
      [f.karigarId, DAY],
    );

    const payment = (await eventOf('payment'))!;
    // A payment moves money, not goods. An empty list rather than a null keeps
    // every client from having to guard the field.
    expect(payment.lines).toEqual([]);
    expect(payment.amount).toBe(500);
  });
});
