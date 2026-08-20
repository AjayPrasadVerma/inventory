/**
 * Karigar job chain — "kitna diya vs kitna maal aaya". These cover the defects
 * QA found here: an edit that rewrote the goods-received date, an edit that never
 * reversed returned material, and a delete that had to reverse money too.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { migrate, reset, pool, query } from './helpers/db.js';
import { seedFixtures, rawOnHand, finishedOnHand, type Fixtures } from './helpers/fixtures.js';
import { jobsRepo } from '../src/modules/jobs/jobs.repo.js';
import { karigarsRepo } from '../src/modules/karigars/karigars.repo.js';

let f: Fixtures;
beforeAll(migrate);
beforeEach(async () => { await reset(); f = await seedFixtures(); });
afterAll(() => pool.end());

const issue = (f: Fixtures, qty = 20) =>
  ({ item_id: f.itemId, variant_id: f.itemVariantId, unit: f.itemUnit, qty });
const receipt = (f: Fixtures, qty = 8) =>
  ({ product_id: f.productId, variant_id: f.productVariantId, qty });

/** Stock the material first, so on-hand movements are readable rather than negative. */
async function stockUp(f: Fixtures, qty = 100) {
  await query(
    `INSERT INTO stock_movements (item_id,variant_id,unit,qty,reason) VALUES ($1,$2,$3,$4,'adjustment')`,
    [f.itemId, f.itemVariantId, f.itemUnit, qty]);
}

describe('issue and receive', () => {
  it('moves raw stock out and finished stock in', async () => {
    await stockUp(f);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f, 20)] } as never);
    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(80);

    await jobsRepo.addReceipt(job.id, [receipt(f, 8)], [], null);
    expect(await finishedOnHand(f.productId)).toBe(8);
  });

  it('records diya, aaya and returns separately on the khata', async () => {
    await stockUp(f);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f, 20)] } as never);
    await jobsRepo.addReceipt(job.id, [receipt(f, 8)], [{ ...issue(f, 3) }], null);

    const k = (await karigarsRepo.khata(f.karigarId))!;
    const j = k.jobs.find((x) => x.id === job.id)!;
    expect(j.issued).toHaveLength(1);
    expect(Number(j.issued[0]!.qty)).toBe(20);
    expect(Number(j.received[0]!.qty)).toBe(8);
    expect(Number(j.returned[0]!.qty)).toBe(3);
  });
});

describe('edit', () => {
  it('keeps the date goods were actually received', async () => {
    await stockUp(f);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, job_date: '2026-06-01', issues: [issue(f)] } as never);
    await jobsRepo.addReceipt(job.id, [receipt(f, 8)], [], '2026-07-15');

    await jobsRepo.editJob(job.id, { notes: 'touched', job_date: '2026-06-01' } as never);

    const r = await query<{ received_on: string }>(
      `SELECT received_on FROM job_receipts WHERE job_id = $1`, [job.id]);
    // Editing anything on the job must not backdate the maal-aaya event.
    expect(r.rows[0]!.received_on).toBe('2026-07-15');
  });

  it('leaves no stock behind when issues are cleared', async () => {
    await stockUp(f);
    const before = await rawOnHand(f.itemId, f.itemUnit);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f, 10)] } as never);
    await jobsRepo.addReceipt(job.id, [], [{ ...issue(f, 3) }], null);

    await jobsRepo.editJob(job.id, { issues: [] } as never);

    // Nothing was issued any more, so nothing may remain credited from a return.
    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(before);
  });

  it('replaces rather than double-counting', async () => {
    await stockUp(f);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f, 20)] } as never);
    await jobsRepo.editJob(job.id, { issues: [issue(f, 5)] } as never);
    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(95);
  });

  it('treats undefined issues as "leave alone"', async () => {
    await stockUp(f);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f, 20)] } as never);
    await jobsRepo.editJob(job.id, { notes: 'only notes' } as never);
    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(80);
  });
});

describe('delete', () => {
  it('reverses stock on both sides and the money paid for the job', async () => {
    await stockUp(f);
    const before = await rawOnHand(f.itemId, f.itemUnit);
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f, 20)] } as never);
    await jobsRepo.addReceipt(job.id, [receipt(f, 8)], [], null);
    await query(
      `INSERT INTO payments (party_type,party_id,direction,amount,method,job_id)
       VALUES ('karigar',$1,'paid',450,'Cash',$2)`, [f.karigarId, job.id]);

    await jobsRepo.deleteJob(job.id);

    expect(await rawOnHand(f.itemId, f.itemUnit)).toBe(before);
    expect(await finishedOnHand(f.productId)).toBe(0);
    const pay = await query(`SELECT 1 FROM payments WHERE party_id = $1`, [f.karigarId]);
    expect(pay.rowCount).toBe(0);
  });
});

describe('khata invariants', () => {
  it('total paid equals the karigar list figure', async () => {
    const job = await jobsRepo.create({ karigar_id: f.karigarId, issues: [issue(f)] } as never);
    await query(
      `INSERT INTO payments (party_type,party_id,direction,amount,method,job_id)
       VALUES ('karigar',$1,'paid',600,'Cash',$2)`, [f.karigarId, job.id]);
    await query(
      `INSERT INTO payments (party_type,party_id,direction,amount,method) VALUES ('karigar',$1,'paid',100,'Cash')`,
      [f.karigarId]);

    const k = (await karigarsRepo.khata(f.karigarId))!;
    const { rows } = await karigarsRepo.list({ limit: 10, offset: 0 } as never);
    const listed = rows.find((r) => r.id === f.karigarId)! as unknown as { total_paid: string };

    expect(k.totals.paid).toBe(700);
    expect(Number(listed.total_paid)).toBe(k.totals.paid);
    // A payment with no job must stay visible as unlinked, never vanish.
    expect(k.unlinked).toHaveLength(1);
    expect(k.jobs.find((j) => j.id === job.id)!.paid).toBe(600);
  });
});
