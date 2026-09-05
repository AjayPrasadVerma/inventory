/**
 * The karigar picker's source list.
 *
 * Every form that books goods or a payment against a karigar opens by asking for
 * this, so it is the one query in the module that runs on nearly every page. It
 * used to select every active karigar with no limit and no search — fine at the
 * two hundred this shop has, a table scan sent down the wire at a few thousand.
 * These pin the bound and the search that replaced it.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, resetTransactions, pool, query } from './helpers/db.js';
import { seedFixtures } from './helpers/fixtures.js';
import { karigarsRepo } from '../src/modules/karigars/karigars.repo.js';

beforeAll(async () => {
  await setupSchema();
  await seedFixtures();
  await query(
    `INSERT INTO karigars (name, phone, product_types)
     SELECT 'Bulk Karigar ' || g, '90000010' || lpad(g::text, 2, '0'), ARRAY['Box']
     FROM generate_series(1, 30) AS g`,
  );
});
beforeEach(resetTransactions);
afterAll(async () => { await pool.end(); });

describe('karigar options', () => {
  it('never returns more than it was asked for', async () => {
    expect(await karigarsRepo.options({ limit: 5 })).toHaveLength(5);
  });

  it('finds a karigar the first page would never have reached', async () => {
    const page = await karigarsRepo.options({ limit: 5 });
    expect(page.map((k) => k.name)).not.toContain('Bulk Karigar 29');

    const found = await karigarsRepo.options({ q: 'Bulk Karigar 29', limit: 5 });
    expect(found.map((k) => k.name)).toEqual(['Bulk Karigar 29']);
  });

  it('searches the phone as well as the name', async () => {
    // The picker shows the phone under the name because two karigars share a
    // first name often enough that it is how the owner tells them apart.
    const found = await karigarsRepo.options({ q: '9000001007' });
    expect(found.map((k) => k.name)).toEqual(['Bulk Karigar 7']);
  });

  it('treats a wildcard as literal text, not as a match-all', async () => {
    expect(await karigarsRepo.options({ q: '%' })).toHaveLength(0);
  });

  it('leaves removed karigars out however it is called', async () => {
    await query(`UPDATE karigars SET is_active = FALSE WHERE name = 'Bulk Karigar 3'`);
    const found = await karigarsRepo.options({ q: 'Bulk Karigar 3' });
    expect(found.map((k) => k.name)).not.toContain('Bulk Karigar 3');
  });
});
