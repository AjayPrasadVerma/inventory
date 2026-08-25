/**
 * Karigar movement log. The point of this module is that IN and OUT stopped
 * being paired: a job used to force a receipt to hang off an issue, so goods
 * could not be recorded arriving unless material had already gone out against
 * that same job. These cover that, plus the inline catalogue creation that
 * replaced "go and build a product first", and the stock either direction moves.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, resetTransactions, pool, query } from './helpers/db.js';
import { seedFixtures, rawOnHand, finishedOnHand, type Fixtures } from './helpers/fixtures.js';
import { karigarEntriesRepo } from '../src/modules/karigar-entries/karigar-entries.repo.js';

let f: Fixtures;

beforeAll(async () => {
  await setupSchema();
  f = await seedFixtures();
});
beforeEach(resetTransactions);
afterAll(async () => { await pool.end(); });

const nameCount = async (table: 'items' | 'products', name: string) =>
  Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE lower(name) = lower($1)`, [name])).rows[0]!.n);

describe('in without out', () => {
  it('records goods arriving with no prior issue', async () => {
    const before = await finishedOnHand(f.productId);
    const { id } = await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'in',
      entry_date: '2026-06-10',
      lines: [{ name: 'Test Ring Box', size: 'Small', qty: 12 }],
    });
    expect(id).toBeGreaterThan(0);
    expect(await finishedOnHand(f.productId)).toBe(before + 12);

    const { entries } = await karigarEntriesRepo.log(f.karigarId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe('in');
    expect(entries[0]!.lines).toHaveLength(1);
  });

  it('records material going out with no receipt to follow', async () => {
    const before = await rawOnHand(f.itemId, 'meter');
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'out',
      lines: [{ name: 'Test Velvet', size: 'meter', design: 'Red', qty: 9 }],
    });
    expect(await rawOnHand(f.itemId, 'meter')).toBe(before - 9);
  });
});

describe('inline catalogue', () => {
  it('creates an item that does not exist yet', async () => {
    expect(await nameCount('items', 'Brand New Board')).toBe(0);
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'out',
      lines: [{ name: 'Brand New Board', size: 'sheet', design: 'Grey', qty: 4 }],
    });
    expect(await nameCount('items', 'Brand New Board')).toBe(1);

    // The typed size and design are normalised into the catalogue, which is what
    // keeps every existing stock query — all keyed on these tables — working.
    const unit = await query(
      `SELECT 1 FROM item_units u JOIN items i ON i.id = u.item_id
       WHERE lower(i.name) = 'brand new board' AND u.unit = 'sheet'`);
    expect(unit.rowCount).toBe(1);
    const colour = await query(
      `SELECT 1 FROM item_variants v JOIN items i ON i.id = v.item_id
       WHERE lower(i.name) = 'brand new board' AND v.color = 'Grey'`);
    expect(colour.rowCount).toBe(1);
  });

  it('reuses an existing name instead of duplicating it, whatever the case', async () => {
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'out',
      lines: [{ name: 'test velvet', size: 'meter', design: 'Red', qty: 2 }],
    });
    expect(await nameCount('items', 'Test Velvet')).toBe(1);
  });

  it('splits size and design on a finished variant', async () => {
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'in',
      lines: [{ name: 'Test Ring Box', size: '2x3', design: 'Floral', qty: 5 }],
    });
    const v = await query<{ variant: string; size: string; design: string }>(
      `SELECT variant, size, design FROM product_variants
       WHERE product_id = $1 AND size = '2x3' AND design = 'Floral'`, [f.productId]);
    expect(v.rowCount).toBe(1);
    // `variant` stays the composed label so older readers of that column still work.
    expect(v.rows[0]!.variant).toBe('2x3 · Floral');
  });

  it('does not create a variant when neither size nor design is given', async () => {
    const before = Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM product_variants WHERE product_id = $1`, [f.productId])).rows[0]!.n);
    await karigarEntriesRepo.create({
      karigar_id: f.karigarId,
      direction: 'in',
      lines: [{ name: 'Test Ring Box', qty: 3 }],
    });
    const after = Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM product_variants WHERE product_id = $1`, [f.productId])).rows[0]!.n);
    expect(after).toBe(before);
  });
});

describe('log order', () => {
  it('is newest first, and same-day entries keep the order they were recorded', async () => {
    const a = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'out', entry_date: '2026-06-01',
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 1 }],
    });
    const b = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'in', entry_date: '2026-06-05',
      lines: [{ name: 'Test Ring Box', size: 'Small', qty: 1 }],
    });
    const c = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'out', entry_date: '2026-06-05',
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 2 }],
    });

    const { entries } = await karigarEntriesRepo.log(f.karigarId);
    // Two on 06-05: the later insert comes first, then the earlier, then 06-01.
    expect(entries.map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe('advance and delete', () => {
  it('attaches the advance to the entry', async () => {
    const { id } = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'out', entry_date: '2026-06-02',
      remark: 'advance diya',
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 5 }],
      advance: { amount: 900, method: 'Cash' },
    });
    const { entries, totals } = await karigarEntriesRepo.log(f.karigarId);
    const e = entries.find((x) => x.id === id)!;
    expect(e.paid).toBe(900);
    expect(e.payments).toHaveLength(1);
    expect(totals.paid).toBe(900);
  });

  it('reverses stock and the advance when the entry is deleted', async () => {
    const rawBefore = await rawOnHand(f.itemId, 'meter');
    const finBefore = await finishedOnHand(f.productId);

    const out = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'out',
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 6 }],
      advance: { amount: 400, method: 'Cash' },
    });
    const inn = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'in',
      lines: [{ name: 'Test Ring Box', size: 'Small', qty: 7 }],
    });
    expect(await rawOnHand(f.itemId, 'meter')).toBe(rawBefore - 6);
    expect(await finishedOnHand(f.productId)).toBe(finBefore + 7);

    expect(await karigarEntriesRepo.remove(f.karigarId, out.id)).toBe(true);
    expect(await karigarEntriesRepo.remove(f.karigarId, inn.id)).toBe(true);

    expect(await rawOnHand(f.itemId, 'meter')).toBe(rawBefore);
    expect(await finishedOnHand(f.productId)).toBe(finBefore);
    // Money must not survive the document it was paid against.
    const pays = await query(
      `SELECT 1 FROM payments WHERE party_type='karigar' AND party_id=$1 AND karigar_entry_id=$2`,
      [f.karigarId, out.id]);
    expect(pays.rowCount).toBe(0);
  });

  it('refuses to delete another karigar\'s entry', async () => {
    const other = (await query<{ id: number }>(
      `INSERT INTO karigars (name) VALUES ('Someone Else') RETURNING id`)).rows[0]!.id;
    const { id } = await karigarEntriesRepo.create({
      karigar_id: f.karigarId, direction: 'out',
      lines: [{ name: 'Test Velvet', size: 'meter', qty: 1 }],
    });
    expect(await karigarEntriesRepo.remove(other, id)).toBe(false);
    const { entries } = await karigarEntriesRepo.log(f.karigarId);
    expect(entries.some((e) => e.id === id)).toBe(true);
  });
});

describe('suggestions', () => {
  it('offers only the catalogue for that direction', async () => {
    const out = await karigarEntriesRepo.suggest('out', 'Test');
    expect(out.map((r) => r.name)).toContain('Test Velvet');
    expect(out.map((r) => r.name)).not.toContain('Test Ring Box');

    const inn = await karigarEntriesRepo.suggest('in', 'Test');
    expect(inn.map((r) => r.name)).toContain('Test Ring Box');
    expect(inn.map((r) => r.name)).not.toContain('Test Velvet');
  });

  it('returns the sizes and designs already used for a name', async () => {
    const out = await karigarEntriesRepo.suggest('out', 'Test Velvet');
    const velvet = out.find((r) => r.name === 'Test Velvet')!;
    expect(velvet.sizes).toContain('meter');
    expect(velvet.sizes).toContain('roll');
    expect(velvet.designs).toContain('Red');
  });

  it('treats a wildcard as literal text, not as a match-all', async () => {
    // The LIKE escaping this relies on is the fix from the earlier guard sweep;
    // without it "%" would list the entire catalogue.
    const all = await karigarEntriesRepo.suggest('out', '%');
    expect(all).toHaveLength(0);
  });
});
