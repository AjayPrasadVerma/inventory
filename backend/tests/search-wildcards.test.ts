/**
 * `%` and `_` are LIKE wildcards. Every list endpoint interpolated the search term
 * straight into a LIKE pattern, so searching "%" returned every row in the table
 * and defeated every index — and a term that legitimately contains a percent sign
 * ("100% Cotton") matched the wrong rows.
 *
 * likeTerm() escapes them and each statement now declares ESCAPE. These cases run
 * against the real repos, because the bug was in the SQL, not in the helper.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { migrate, reset, pool, query } from './helpers/db.js';
import { likeTerm } from '../src/utils/sql.js';
import { vendorsRepo } from '../src/modules/vendors/vendors.repo.js';
import { itemsRepo } from '../src/modules/items/items.repo.js';
import { karigarsRepo } from '../src/modules/karigars/karigars.repo.js';
import { productsRepo } from '../src/modules/products/products.repo.js';
import { catalogueRepo } from '../src/modules/catalogue/catalogue.repo.js';

beforeAll(migrate);
beforeEach(async () => {
  await reset();
  // Names that contain the wildcards themselves, so escaping is observable.
  await query(`INSERT INTO vendors (name, phone, city) VALUES
    ('Sharma Cloth','9000000001','Jaipur'),
    ('100% Pure Silk','9000000002','Surat'),
    ('A_B Traders','9000000003','Delhi')`);
  await query(`INSERT INTO karigars (name, phone) VALUES ('Ramesh','9000000004')`);
  await query(`INSERT INTO items (name) VALUES ('Velvet'), ('50% Cotton'), ('A_B Board')`);
  await query(`INSERT INTO products (name) VALUES ('Ring Box'), ('80% Gift Box')`);
});
afterAll(() => pool.end());

const names = (r: { rows: { name: string }[] }) => r.rows.map((x) => x.name).sort();

describe('a bare wildcard no longer matches everything', () => {
  // Escaped, "%" is an ordinary character: it matches only the rows whose name
  // actually contains a percent sign, not the whole table. The seed deliberately
  // includes such rows, so 0 would be the wrong expectation for "%" itself.
  it('matches only the rows that literally contain it', async () => {
    expect(names(await vendorsRepo.list({ search: '%', limit: 50, offset: 0 } as never))).toEqual(['100% Pure Silk']);
    expect(names(await itemsRepo.list({ search: '%', limit: 50, offset: 0 } as never))).toEqual(['50% Cotton']);
    expect(names(await productsRepo.list({ search: '%', limit: 50, offset: 0 } as never))).toEqual(['80% Gift Box']);
    expect(names(await vendorsRepo.list({ search: '_', limit: 50, offset: 0 } as never))).toEqual(['A_B Traders']);
    // Not the 3 vendors / 3 items / 2 products an unescaped wildcard returned.
    expect((await catalogueRepo.list({ search: '%', limit: 50, offset: 0 })).total).toBe(2);
  });

  it('returns nothing for a pattern no name contains', async () => {
    for (const term of ['%%', 'a%', '_a', '%_%']) {
      expect((await vendorsRepo.list({ search: term, limit: 50, offset: 0 } as never)).total, `vendors "${term}"`).toBe(0);
      expect((await itemsRepo.list({ search: term, limit: 50, offset: 0 } as never)).total, `items "${term}"`).toBe(0);
      expect((await karigarsRepo.list({ search: term, limit: 50, offset: 0 } as never)).total, `karigars "${term}"`).toBe(0);
      expect((await productsRepo.list({ search: term, limit: 50, offset: 0 } as never)).total, `products "${term}"`).toBe(0);
      expect((await catalogueRepo.list({ search: term, limit: 50, offset: 0 })).total, `catalogue "${term}"`).toBe(0);
    }
  });
});

describe('a term containing a wildcard matches it literally', () => {
  it('finds the percent sign in a real name', async () => {
    expect(names(await vendorsRepo.list({ search: '100%', limit: 50, offset: 0 } as never))).toEqual(['100% Pure Silk']);
    expect(names(await itemsRepo.list({ search: '50%', limit: 50, offset: 0 } as never))).toEqual(['50% Cotton']);
    expect(names(await productsRepo.list({ search: '80%', limit: 50, offset: 0 } as never))).toEqual(['80% Gift Box']);
  });

  it('treats an underscore as a character, not "any character"', async () => {
    expect(names(await vendorsRepo.list({ search: 'A_B', limit: 50, offset: 0 } as never))).toEqual(['A_B Traders']);
    // Were the underscore still a wildcard, "A?B" would also match "A_B Board".
    expect((await itemsRepo.list({ search: 'AxB', limit: 50, offset: 0 } as never)).total).toBe(0);
  });
});

describe('ordinary search is unaffected', () => {
  it('still matches on a substring, case-insensitively, across columns', async () => {
    expect(names(await vendorsRepo.list({ search: 'sharma', limit: 50, offset: 0 } as never))).toEqual(['Sharma Cloth']);
    expect(names(await vendorsRepo.list({ search: 'jaipur', limit: 50, offset: 0 } as never))).toEqual(['Sharma Cloth']);
    expect(names(await vendorsRepo.list({ search: '9000000003', limit: 50, offset: 0 } as never))).toEqual(['A_B Traders']);
    expect(names(await itemsRepo.list({ search: 'velv', limit: 50, offset: 0 } as never))).toEqual(['Velvet']);
    // The merged catalogue reads both sides.
    expect((await catalogueRepo.list({ search: 'box', limit: 50, offset: 0 })).total).toBe(2);
  });
});

describe('likeTerm', () => {
  it('escapes the wildcards and the escape character itself', () => {
    expect(likeTerm('abc')).toBe('%abc%');
    expect(likeTerm('100%')).toBe('%100\\%%');
    expect(likeTerm('A_B')).toBe('%A\\_B%');
    expect(likeTerm('a\\b')).toBe('%a\\\\b%');
  });
});
