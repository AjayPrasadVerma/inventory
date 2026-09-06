/**
 * The karigar and vendor picker lists.
 *
 * Every form that books goods or a payment against someone opens by asking for
 * one of these, so they are the two queries in the app that run on nearly every
 * page. Both used to select every active row with no limit and no search — fine
 * at the few hundred this shop has, a table scan sent down the wire at a few
 * thousand. These pin the bound and the search that replaced it.
 *
 * They are tested together because they are the same query twice: a divergence
 * between them is a bug in whichever one was edited alone.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, resetTransactions, pool, query } from './helpers/db.js';
import { seedFixtures } from './helpers/fixtures.js';
import { karigarsRepo } from '../src/modules/karigars/karigars.repo.js';
import { vendorsRepo } from '../src/modules/vendors/vendors.repo.js';

beforeAll(async () => {
  await setupSchema();
  await seedFixtures();
  await query(
    `INSERT INTO karigars (name, phone, product_types)
     SELECT 'Bulk Karigar ' || g, '90000010' || lpad(g::text, 2, '0'), ARRAY['Box']
     FROM generate_series(1, 30) AS g`,
  );
  await query(
    `INSERT INTO vendors (name, phone, city)
     SELECT 'Bulk Vendor ' || g, '90000020' || lpad(g::text, 2, '0'), 'Jaipur'
     FROM generate_series(1, 30) AS g`,
  );
});
beforeEach(resetTransactions);
afterAll(async () => { await pool.end(); });

/** The two repos differ only in what they select, so they are checked the same way. */
const pickers = [
  { what: 'karigar', repo: karigarsRepo, prefix: 'Bulk Karigar', phone: '9000001007' },
  { what: 'vendor', repo: vendorsRepo, prefix: 'Bulk Vendor', phone: '9000002007' },
] as const;

for (const { what, repo, prefix, phone } of pickers) {
  describe(`${what} options`, () => {
    it('never returns more than it was asked for', async () => {
      expect(await repo.options({ limit: 5 })).toHaveLength(5);
    });

    it('finds one the first page would never have reached', async () => {
      const page = await repo.options({ limit: 5 });
      expect(page.map((r) => r.name)).not.toContain(`${prefix} 29`);

      const found = await repo.options({ q: `${prefix} 29`, limit: 5 });
      expect(found.map((r) => r.name)).toEqual([`${prefix} 29`]);
    });

    it('searches the phone as well as the name', async () => {
      // The picker shows the phone under the name because two people sharing a
      // first name happens often enough that it is how the owner tells them
      // apart — so it has to be searchable too.
      const found = await repo.options({ q: phone });
      expect(found.map((r) => r.name)).toEqual([`${prefix} 7`]);
    });

    it('treats a wildcard as literal text, not as a match-all', async () => {
      expect(await repo.options({ q: '%' })).toHaveLength(0);
    });

    it('leaves removed rows out however it is called', async () => {
      const table = what === 'karigar' ? 'karigars' : 'vendors';
      await query(`UPDATE ${table} SET is_active = FALSE WHERE name = $1`, [`${prefix} 3`]);
      const found = await repo.options({ q: `${prefix} 3` });
      expect(found.map((r) => r.name)).not.toContain(`${prefix} 3`);
    });
  });
}
