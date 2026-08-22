/**
 * A line's variant must belong to the item/product on that same line, and a raw
 * material may only move in a unit it is stocked in.
 *
 * Postgres cannot express either with a foreign key — variant_id references
 * item_variants(id), which proves the variant EXISTS, not that it belongs here.
 * Nothing errors when they disagree; the movement is just filed under the wrong
 * parent, so on-hand quietly splits across a colour the material does not have.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { migrate, reset, pool, query } from './helpers/db.js';
import { seedFixtures, type Fixtures } from './helpers/fixtures.js';
import { assertCatalogueLines } from '../src/utils/catalogue.js';

let f: Fixtures;
/** A second item/product, so we have a variant that provably belongs elsewhere. */
let other: { itemId: number; itemVariantId: number; productId: number; productVariantId: number };

beforeAll(migrate);
beforeEach(async () => {
  await reset();
  f = await seedFixtures();

  const i = (await query<{ id: number }>(
    `INSERT INTO items (name, category) VALUES ('Other Board','Base') RETURNING id`)).rows[0]!;
  await query(`INSERT INTO item_units (item_id, unit, is_default) VALUES ($1,'sheet',TRUE)`, [i.id]);
  const iv = (await query<{ id: number }>(
    `INSERT INTO item_variants (item_id, color) VALUES ($1,'Black') RETURNING id`, [i.id])).rows[0]!;
  const p = (await query<{ id: number }>(
    `INSERT INTO products (name, category) VALUES ('Other Tray','Tray') RETURNING id`)).rows[0]!;
  const pv = (await query<{ id: number }>(
    `INSERT INTO product_variants (product_id, variant) VALUES ($1,'Large') RETURNING id`, [p.id])).rows[0]!;

  other = { itemId: i.id, itemVariantId: iv.id, productId: p.id, productVariantId: pv.id };
});
afterAll(() => pool.end());

describe('variant ownership', () => {
  it('accepts a variant that belongs to its own item', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: f.itemVariantId, unit: f.itemUnit },
    ])).resolves.toBeUndefined();
  });

  it('rejects another item\'s colour', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: other.itemVariantId, unit: f.itemUnit },
    ])).rejects.toThrow(/colour .* does not belong/i);
  });

  it('rejects another product\'s variant', async () => {
    await expect(assertCatalogueLines([
      { kind: 'product', id: f.productId, variant_id: other.productVariantId },
    ])).rejects.toThrow(/variant .* does not belong/i);
  });

  it('rejects a variant id that does not exist at all', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: 999_999, unit: f.itemUnit },
    ])).rejects.toThrow(/does not belong/i);
  });

  it('allows no variant — plenty of materials have none', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: null, unit: f.itemUnit },
    ])).resolves.toBeUndefined();
  });
});

describe('unit belongs to the material', () => {
  it('accepts any unit the item is stocked in', async () => {
    // The fixture item is stocked in both meter and roll.
    for (const unit of ['meter', 'roll']) {
      await expect(assertCatalogueLines([
        { kind: 'item', id: f.itemId, variant_id: null, unit },
      ])).resolves.toBeUndefined();
    }
  });

  it('rejects a unit belonging to a different material', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: null, unit: 'sheet' },
    ])).rejects.toThrow(/not stocked in "sheet"/i);
  });

  it('names the material in the error, so the row can be found', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: null, unit: 'kilo' },
    ])).rejects.toThrow(/Test Velvet/);
  });

  it('does not impose units on products', async () => {
    // Products have no unit catalogue; purchase lines use a nominal "pcs".
    await expect(assertCatalogueLines([
      { kind: 'product', id: f.productId, variant_id: f.productVariantId, unit: 'pcs' },
    ])).resolves.toBeUndefined();
  });
});

describe('batching', () => {
  it('checks every line, not just the first', async () => {
    await expect(assertCatalogueLines([
      { kind: 'item', id: f.itemId, variant_id: f.itemVariantId, unit: f.itemUnit },
      { kind: 'item', id: other.itemId, variant_id: null, unit: 'sheet' },
      { kind: 'item', id: f.itemId, variant_id: other.itemVariantId, unit: f.itemUnit }, // bad
    ])).rejects.toThrow(/does not belong/i);
  });

  it('is a no-op for an empty list', async () => {
    await expect(assertCatalogueLines([])).resolves.toBeUndefined();
  });
});
