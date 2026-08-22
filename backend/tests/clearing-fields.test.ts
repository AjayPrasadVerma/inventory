/**
 * Clearing an optional text field. Both edit paths used COALESCE($n, col), which
 * cannot tell "not provided" from "set this to null" — so a user who emptied the
 * box got a success toast and the old value back. Nothing errored, which is why
 * it survived review.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { migrate, reset, pool, query } from './helpers/db.js';
import { seedFixtures, type Fixtures } from './helpers/fixtures.js';
import { purchasesRepo } from '../src/modules/purchases/purchases.repo.js';
import { jobsRepo } from '../src/modules/jobs/jobs.repo.js';

let f: Fixtures;
beforeAll(migrate);
beforeEach(async () => { await reset(); f = await seedFixtures(); });
afterAll(() => pool.end());

describe('purchase bill_no', () => {
  it('is cleared by an explicit null', async () => {
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId, bill_no: 'B-1',
      items: [{ kind: 'item', item_id: f.itemId, unit: f.itemUnit, qty: 1, rate: 1 }],
    } as never);

    await purchasesRepo.editRow(pur.id, { bill_no: null } as never);

    const r = await query<{ bill_no: string | null }>('SELECT bill_no FROM purchases WHERE id = $1', [pur.id]);
    expect(r.rows[0]!.bill_no).toBeNull();
  });

  it('is left alone when the field is omitted', async () => {
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId, bill_no: 'B-2',
      items: [{ kind: 'item', item_id: f.itemId, unit: f.itemUnit, qty: 1, rate: 1 }],
    } as never);

    await purchasesRepo.editRow(pur.id, { purchase_date: '2026-06-01' } as never);

    const r = await query<{ bill_no: string | null; purchase_date: string }>(
      'SELECT bill_no, purchase_date FROM purchases WHERE id = $1', [pur.id]);
    expect(r.rows[0]!.bill_no).toBe('B-2');
    expect(r.rows[0]!.purchase_date).toBe('2026-06-01');
  });

  it('can be set to a new value', async () => {
    const pur = await purchasesRepo.create({
      vendor_id: f.vendorId, bill_no: 'B-3',
      items: [{ kind: 'item', item_id: f.itemId, unit: f.itemUnit, qty: 1, rate: 1 }],
    } as never);
    await purchasesRepo.editRow(pur.id, { bill_no: 'B-3-rev' } as never);
    const r = await query<{ bill_no: string }>('SELECT bill_no FROM purchases WHERE id = $1', [pur.id]);
    expect(r.rows[0]!.bill_no).toBe('B-3-rev');
  });
});

describe('job notes and expected_note', () => {
  it('are cleared by an explicit null', async () => {
    const job = await jobsRepo.create({
      karigar_id: f.karigarId, notes: 'some note', expected_note: 'make 10 boxes',
      issues: [{ item_id: f.itemId, unit: f.itemUnit, qty: 1 }],
    } as never);

    await jobsRepo.editJob(job.id, { notes: null, expected_note: null } as never);

    const r = await query<{ notes: string | null; expected_note: string | null }>(
      'SELECT notes, expected_note FROM jobs WHERE id = $1', [job.id]);
    expect(r.rows[0]!.notes).toBeNull();
    expect(r.rows[0]!.expected_note).toBeNull();
  });

  it('are left alone when omitted, and status still updates', async () => {
    const job = await jobsRepo.create({
      karigar_id: f.karigarId, notes: 'keep me', expected_note: 'keep me too',
      issues: [{ item_id: f.itemId, unit: f.itemUnit, qty: 1 }],
    } as never);

    await jobsRepo.editJob(job.id, { status: 'closed' } as never);

    const r = await query<{ notes: string | null; expected_note: string | null; status: string }>(
      'SELECT notes, expected_note, status FROM jobs WHERE id = $1', [job.id]);
    expect(r.rows[0]).toMatchObject({ notes: 'keep me', expected_note: 'keep me too', status: 'closed' });
  });

  it('never nulls a NOT NULL column, even when the edit touches nothing else', async () => {
    const job = await jobsRepo.create({
      karigar_id: f.karigarId, job_date: '2026-06-01',
      issues: [{ item_id: f.itemId, unit: f.itemUnit, qty: 1 }],
    } as never);

    // An edit carrying only a cleared note must not disturb job_date or status.
    await jobsRepo.editJob(job.id, { notes: null } as never);

    const r = await query<{ job_date: string; status: string }>(
      'SELECT job_date, status FROM jobs WHERE id = $1', [job.id]);
    expect(r.rows[0]).toMatchObject({ job_date: '2026-06-01', status: 'open' });
  });
});
