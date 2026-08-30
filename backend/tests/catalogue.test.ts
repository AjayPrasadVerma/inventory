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
import { seedFixtures, finishedOnHand, type Fixtures } from './helpers/fixtures.js';
import { assertCatalogueLines } from '../src/utils/catalogue.js';
import { addCatalogueLines, editCatalogueFromSheet } from '../src/modules/catalogue/catalogue.repo.js';
import { productsRepo } from '../src/modules/products/products.repo.js';

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

describe('adding from the sheet', () => {
  const count = async (table: 'items' | 'products', name: string) =>
    Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE lower(name) = lower($1)`, [name])).rows[0]!.n);

  it('creates a raw material and books its opening stock in one call', async () => {
    const out = await addCatalogueLines({
      kind: 'item',
      on_date: '2026-06-01',
      lines: [{ name: 'Sheet Velvet', size: 'meter', design: 'Maroon', qty: 40 }],
    });
    expect(out).toEqual({ created: 1, stocked: 1 });
    expect(await count('items', 'Sheet Velvet')).toBe(1);

    // Size became the unit and design the colour, so the stock page counts it the
    // same way every other path does.
    const mv = await query<{ unit: string; qty: string; reason: string; note: string }>(
      `SELECT sm.unit, sm.qty, sm.reason, sm.note FROM stock_movements sm
       JOIN items i ON i.id = sm.item_id WHERE lower(i.name) = 'sheet velvet'`);
    expect(mv.rowCount).toBe(1);
    expect(mv.rows[0]!.unit).toBe('meter');
    expect(Number(mv.rows[0]!.qty)).toBe(40);
    expect(mv.rows[0]!.reason).toBe('adjustment');
    expect(mv.rows[0]!.note).toBe('Opening stock');
  });

  it('creates a finished product with size and design split apart', async () => {
    await addCatalogueLines({
      kind: 'product',
      lines: [{ name: 'Sheet Ring Box', size: '2x3', design: 'Floral', qty: 12 }],
    });
    const v = await query<{ variant: string; size: string; design: string }>(
      `SELECT pv.variant, pv.size, pv.design FROM product_variants pv
       JOIN products p ON p.id = pv.product_id WHERE lower(p.name) = 'sheet ring box'`);
    expect(v.rowCount).toBe(1);
    expect(v.rows[0]!.size).toBe('2x3');
    expect(v.rows[0]!.design).toBe('Floral');
    expect(await finishedOnHand((await query<{ id: number }>(
      `SELECT id FROM products WHERE lower(name) = 'sheet ring box'`)).rows[0]!.id)).toBe(12);
  });

  it('creates the row without stock when no quantity is given', async () => {
    const out = await addCatalogueLines({
      kind: 'item',
      lines: [{ name: 'Not Yet Stocked', size: 'roll' }],
    });
    expect(out).toEqual({ created: 1, stocked: 0 });
    expect(await count('items', 'Not Yet Stocked')).toBe(1);
    const mv = await query(
      `SELECT 1 FROM stock_movements sm JOIN items i ON i.id = sm.item_id
       WHERE lower(i.name) = 'not yet stocked'`);
    expect(mv.rowCount).toBe(0);
  });

  it('reuses a name already in the catalogue instead of duplicating it', async () => {
    await addCatalogueLines({ kind: 'item', lines: [{ name: 'Twice Named', size: 'meter', qty: 5 }] });
    await addCatalogueLines({ kind: 'item', lines: [{ name: 'twice named', size: 'roll', qty: 3 }] });
    expect(await count('items', 'Twice Named')).toBe(1);
    // Both units are on the one item, and both movements landed.
    const units = await query(
      `SELECT u.unit FROM item_units u JOIN items i ON i.id = u.item_id
       WHERE lower(i.name) = 'twice named' ORDER BY u.unit`);
    expect(units.rows.map((r: { unit: string }) => r.unit)).toEqual(['meter', 'roll']);
  });

  it('leaves nothing behind when a line in the batch fails', async () => {
    await expect(addCatalogueLines({
      kind: 'item',
      lines: [
        { name: 'Batch Good', size: 'meter', qty: 5 },
        { name: 'Batch Bad', size: 'meter', qty: -1 },
      ],
    })).rejects.toThrow();
    // The first line's catalogue row must go back with the failed transaction.
    expect(await count('items', 'Batch Good')).toBe(0);
  });
});

describe('editing a product keeps size and design apart', () => {
  const variantRows = async (productId: number) =>
    (await query<{ variant: string; size: string | null; design: string | null }>(
      `SELECT variant, size, design FROM product_variants WHERE product_id = $1 ORDER BY variant`,
      [productId])).rows;

  it('stores the parts when the edit form sends a pair', async () => {
    await addCatalogueLines({ kind: 'product', lines: [{ name: 'Edit Box', size: '2x3', design: 'Floral', qty: 1 }] });
    const id = (await query<{ id: number }>(`SELECT id FROM products WHERE lower(name)='edit box'`)).rows[0]!.id;

    await productsRepo.update(id, {
      name: 'Edit Box',
      variants: [{ size: '2x3', design: 'Floral' }, { size: '5x8', design: 'Plain' }],
    });

    const rows = await variantRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.variant === '2x3 · Floral')).toMatchObject({ size: '2x3', design: 'Floral' });
    // The one added through the edit form carries its parts too — before this it
    // would have been stored with the label only, and shown blank in the sheet.
    expect(rows.find((r) => r.variant === '5x8 · Plain')).toMatchObject({ size: '5x8', design: 'Plain' });
  });

  it('refreshes the parts of a variant that already exists', async () => {
    await addCatalogueLines({ kind: 'product', lines: [{ name: 'Refresh Box', size: '4x4', qty: 1 }] });
    const id = (await query<{ id: number }>(`SELECT id FROM products WHERE lower(name)='refresh box'`)).rows[0]!.id;

    // Same label, now with a design added alongside the size it already had.
    await productsRepo.update(id, { name: 'Refresh Box', variants: [{ size: '4x4', design: null }] });
    expect((await variantRows(id))[0]).toMatchObject({ size: '4x4', design: null });
  });

  it('still accepts a bare label from an older caller', async () => {
    await addCatalogueLines({ kind: 'product', lines: [{ name: 'Legacy Box', size: 'Small', qty: 1 }] });
    const id = (await query<{ id: number }>(`SELECT id FROM products WHERE lower(name)='legacy box'`)).rows[0]!.id;

    await productsRepo.update(id, { name: 'Legacy Box', variants: ['Small', 'Large'] });
    const rows = await variantRows(id);
    expect(rows.map((r) => r.variant).sort()).toEqual(['Large', 'Small']);
    // A bare string carries no parts, and splitting the label to invent some
    // would be guessing at data the caller never sent.
    expect(rows.find((r) => r.variant === 'Large')).toMatchObject({ size: null, design: null });
  });
});

describe('editing from the sheet', () => {
  const onHandRaw = async (itemId: number, unit: string) =>
    Number((await query<{ q: string | null }>(
      `SELECT SUM(qty)::text AS q FROM stock_movements WHERE item_id=$1 AND unit=$2`,
      [itemId, unit])).rows[0]?.q ?? 0);

  const makeRaw = async (name: string, qty: number) => {
    await addCatalogueLines({ kind: 'item', lines: [{ name, size: 'meter', design: 'Red', qty }] });
    return (await query<{ id: number }>(
      `SELECT id FROM items WHERE lower(name)=lower($1)`, [name])).rows[0]!.id;
  };

  it('books the difference, so saving the same number twice changes nothing', async () => {
    const id = await makeRaw('Delta Velvet', 40);
    expect(await onHandRaw(id, 'meter')).toBe(40);

    // Opening the sheet and saving it untouched must be a no-op — this is the
    // failure that would otherwise double the stock every time.
    let out = await editCatalogueFromSheet({
      kind: 'item', id, name: 'Delta Velvet',
      lines: [{ size: 'meter', design: 'Red', qty: 40 }],
    });
    expect(out.adjusted).toBe(0);
    expect(await onHandRaw(id, 'meter')).toBe(40);

    // Correcting it upward books only what is missing.
    out = await editCatalogueFromSheet({
      kind: 'item', id, name: 'Delta Velvet',
      lines: [{ size: 'meter', design: 'Red', qty: 55 }],
    });
    expect(out.adjusted).toBe(1);
    expect(await onHandRaw(id, 'meter')).toBe(55);

    // And downward.
    await editCatalogueFromSheet({
      kind: 'item', id, name: 'Delta Velvet',
      lines: [{ size: 'meter', design: 'Red', qty: 12 }],
    });
    expect(await onHandRaw(id, 'meter')).toBe(12);
  });

  it('renames the record without creating a second one', async () => {
    const id = await makeRaw('Old Name', 5);
    await editCatalogueFromSheet({
      kind: 'item', id, name: 'New Name',
      lines: [{ size: 'meter', design: 'Red', qty: 5 }],
    });
    const rows = await query(`SELECT id FROM items WHERE lower(name) IN ('old name','new name')`);
    expect(rows.rowCount).toBe(1);
    expect((await query<{ name: string }>(`SELECT name FROM items WHERE id=$1`, [id])).rows[0]!.name).toBe('New Name');
  });

  it('refuses a rename onto a name already in that catalogue', async () => {
    const a = await makeRaw('Keep Me', 1);
    await makeRaw('Take My Name', 1);
    await expect(editCatalogueFromSheet({
      kind: 'item', id: a, name: 'Take My Name', lines: [],
    })).rejects.toThrow(/already called/i);
    // The first name survives the refusal.
    expect((await query<{ name: string }>(`SELECT name FROM items WHERE id=$1`, [a])).rows[0]!.name).toBe('Keep Me');
  });

  it('leaves a line alone when its quantity is blank', async () => {
    const id = await makeRaw('Untouched', 30);
    const out = await editCatalogueFromSheet({
      kind: 'item', id, name: 'Untouched',
      lines: [{ size: 'meter', design: 'Red', qty: null }],
    });
    expect(out.adjusted).toBe(0);
    expect(await onHandRaw(id, 'meter')).toBe(30);
  });

  it('adds a size that was not there before', async () => {
    const id = await makeRaw('Grow Sizes', 10);
    await editCatalogueFromSheet({
      kind: 'item', id, name: 'Grow Sizes',
      lines: [{ size: 'meter', design: 'Red', qty: 10 }, { size: 'roll', design: 'Red', qty: 4 }],
    });
    const units = await query<{ unit: string }>(
      `SELECT unit FROM item_units WHERE item_id=$1 ORDER BY unit`, [id]);
    expect(units.rows.map((r) => r.unit)).toEqual(['meter', 'roll']);
    expect(await onHandRaw(id, 'roll')).toBe(4);
  });

  it('corrects a finished product against its own variant', async () => {
    await addCatalogueLines({ kind: 'product', lines: [{ name: 'Edit Fin', size: '2x3', design: 'Floral', qty: 20 }] });
    const id = (await query<{ id: number }>(`SELECT id FROM products WHERE lower(name)='edit fin'`)).rows[0]!.id;
    expect(await finishedOnHand(id)).toBe(20);

    await editCatalogueFromSheet({
      kind: 'product', id, name: 'Edit Fin',
      lines: [{ size: '2x3', design: 'Floral', qty: 8 }],
    });
    expect(await finishedOnHand(id)).toBe(8);
  });
});
