/**
 * Demo data for inventory_dev: `npm run seed:demo`.
 *
 * Not the same thing as `npm run seed`, which creates the first owner login and
 * nothing else. This fills the shop — vendors, karigars, a catalogue, a day of
 * purchases, karigar entries and payments — so the dashboard and the phone app
 * can be looked at with something in them.
 *
 * Needed because `npm test` truncates inventory_dev (CLAUDE.md §4), so every
 * test run empties the screens. Re-runnable: it clears what it made first.
 *
 * The day it seeds is deliberately the shape the shop actually has — one
 * thirty-five line purchase and one thirty-line karigar entry, not three tidy
 * rows. A demo with three lines per entry hides every layout problem worth
 * finding.
 *
 * Refuses to run against anything but inventory_dev. It writes to every business
 * table, and the one database that must never see that is production.
 *
 * `users` is not touched: the login has to survive.
 */
import 'dotenv/config';
import { pool, query } from '../config/db.js';

// Checked by name, the same way the test harness checks (backend/tests/helpers/
// db.ts). This writes to every business table and truncates first, so the one
// database it must never open is production — and dev and production share a
// Postgres host, which means the name is the only thing that tells them apart.
const db = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
if (db !== 'inventory_dev') {
  console.error(`Refusing to seed "${db || '(no DATABASE_URL)'}". This only runs against inventory_dev.`);
  process.exit(1);
}

const one = async <T extends Record<string, unknown> = { id: number }>(
  sql: string,
  params: unknown[] = [],
): Promise<T> => (await query<T>(sql, params)).rows[0]!;

// Clear what a previous run made, so this can be re-run without piling up.
// Children before parents; users and migrations are left alone.
for (const t of [
  'payments', 'karigar_entry_lines', 'karigar_entries',
  'purchase_items', 'purchases', 'finished_stock_movements', 'stock_movements',
  'product_variants', 'products', 'item_variants', 'item_units', 'items',
  'karigars', 'vendors',
]) {
  await query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`);
}

// ── Catalogue ───────────────────────────────────────────────────────────
const vendor = await one(
  `INSERT INTO vendors (name, phone, city) VALUES ($1,$2,$3) RETURNING id`,
  ['Ramesh Textiles', '9820011223', 'Surat'],
);
await query(`INSERT INTO vendors (name, phone, city) VALUES ($1,$2,$3)`,
  ['Shakti Board & Paper', '9820044556', 'Mumbai']);

const imran = await one(
  `INSERT INTO karigars (name, phone, product_types) VALUES ($1,$2,$3) RETURNING id`,
  ['Imran bhai', '9833112233', ['box']],
);
const salim = await one(
  `INSERT INTO karigars (name, phone, product_types) VALUES ($1,$2,$3) RETURNING id`,
  ['Salim', '9833445566', ['box', 'stand']],
);

/** An item with one unit and one colour, ready to be stocked. */
interface SeededItem { id: number; unit: string; variantId: number | null }

async function item(
  name: string,
  category: string,
  unit: string,
  colour: string | null,
  lowQty: number | null,
): Promise<SeededItem> {
  const it = await one(
    `INSERT INTO items (name, category, low_stock_qty) VALUES ($1,$2,$3) RETURNING id`,
    [name, category, lowQty],
  );
  await query(`INSERT INTO item_units (item_id, unit, is_default) VALUES ($1,$2,TRUE)`, [it.id, unit]);
  const v = colour
    ? await one(`INSERT INTO item_variants (item_id, color) VALUES ($1,$2) RETURNING id`, [it.id, colour])
    : null;
  return { id: it.id, unit, variantId: v?.id ?? null };
}

const velvet = await item('Velvet', 'Kapda', 'meter', 'Maroon', 10);
const board = await item('Grey Board', 'Kagaz', 'sheet', null, 100);
const foam = await item('Foam Sheet', 'Kapda', 'sheet', null, null);

interface SeededProduct { id: number; variantId: number }

async function product(
  name: string,
  category: string,
  variant: string,
  lowQty: number,
): Promise<SeededProduct> {
  const p = await one(
    `INSERT INTO products (name, category, low_stock_qty) VALUES ($1,$2,$3) RETURNING id`,
    [name, category, lowQty],
  );
  const v = await one(
    `INSERT INTO product_variants (product_id, variant, size) VALUES ($1,$2,$3) RETURNING id`,
    [p.id, variant, variant],
  );
  return { id: p.id, variantId: v.id };
}

const ringBox = await product('Ring Box', 'Box', 'Small', 25);
const bangleBox = await product('Bangle Box', 'Box', 'Medium', 20);

// ── A purchase, today ───────────────────────────────────────────────────
const purchase = await one(
  `INSERT INTO purchases (vendor_id, bill_no, purchase_date, total_amount)
   VALUES ($1,$2,CURRENT_DATE,$3) RETURNING id`,
  [vendor.id, '402', 18600],
);
const buy = async (it: SeededItem, qty: number, rate: number) => {
  await query(
    `INSERT INTO purchase_items (purchase_id, item_id, variant_id, unit, qty, rate, amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [purchase.id, it.id, it.variantId, it.unit, qty, rate, qty * rate],
  );
  await query(
    `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
     VALUES ($1,$2,$3,$4,'purchase',$5,$6,CURRENT_DATE)`,
    [it.id, it.variantId, it.unit, qty, purchase.id, vendor.id],
  );
};
await buy(velvet, 120, 95);
await buy(board, 80, 42);
await buy(foam, 60, 60);

// ── Material out to a karigar, today ────────────────────────────────────
const out = await one(
  `INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark)
   VALUES ($1,'out',CURRENT_DATE,$2) RETURNING id`,
  [imran.id, 'Cutting for ring boxes'],
);
const issue = async (
  it: SeededItem,
  size: string,
  qty: number,
  design: string | null = null,
) => {
  await query(
    `INSERT INTO karigar_entry_lines (entry_id, item_id, size, design, qty)
     VALUES ($1,$2,$3,$4,$5)`,
    [out.id, it.id, size, design, qty],
  );
  await query(
    `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, moved_on)
     VALUES ($1,$2,$3,$4,'karigar_out',$5,CURRENT_DATE)`,
    [it.id, it.variantId, it.unit, -qty, out.id],
  );
};
// 122.5 issued against 120 bought, so Velvet lands at -2.5 and shows as Oversold.
// The books disagreeing with the shelf is exactly what that row is for.
await issue(velvet, 'meter', 122.5, 'Maroon');
await issue(board, 'sheet', 30);

// ── Finished goods back in, today ───────────────────────────────────────
const back = await one(
  `INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark)
   VALUES ($1,'in',CURRENT_DATE,$2) RETURNING id`,
  [salim.id, 'Finished boxes'],
);
const receive = async (
  p: SeededProduct,
  size: string,
  qty: number,
  design: string | null = null,
) => {
  await query(
    `INSERT INTO karigar_entry_lines (entry_id, product_id, size, design, qty)
     VALUES ($1,$2,$3,$4,$5)`,
    [back.id, p.id, size, design, qty],
  );
  await query(
    `INSERT INTO finished_stock_movements (product_id, variant_id, qty, reason, ref_id, moved_on)
     VALUES ($1,$2,$3,'job_receipt',$4,CURRENT_DATE)`,
    [p.id, p.variantId, qty, back.id],
  );
};
// 18 against a threshold of 25 — Low, but not oversold.
await receive(ringBox, 'Small', 18);
await receive(bangleBox, 'Medium', 140);

// ── Money out, today ────────────────────────────────────────────────────
await query(
  `INSERT INTO payments (party_type, party_id, direction, amount, method, pay_date, ref_note)
   VALUES ('karigar',$1,'paid',$2,'upi',CURRENT_DATE,$3)`,
  [imran.id, 3500, 'Weekly settlement'],
);
await query(
  `INSERT INTO payments (party_type, party_id, direction, amount, method, pay_date, ref_note)
   VALUES ('vendor',$1,'paid',$2,'cash',CURRENT_DATE,$3)`,
  [vendor.id, 8000, 'Against bill 402'],
);

// ── A real-sized day ────────────────────────────────────────────────────
// The owner's actual shape: one purchase, or one karigar entry, routinely
// carries thirty to forty lines. A demo with three lines per event makes the
// feed look fine and hides the layout problem, so this seeds the real thing.
const COLOURS = [
  'Maroon', 'Navy', 'Bottle Green', 'Rani Pink', 'Mustard', 'Black', 'Ivory',
  'Rust', 'Teal', 'Wine', 'Peach', 'Olive', 'Grey', 'Sky', 'Lavender',
  'Coffee', 'Beige', 'Magenta', 'Turquoise', 'Gold', 'Silver', 'Copper',
  'Cream', 'Charcoal', 'Emerald', 'Ruby', 'Sapphire', 'Coral', 'Mint',
  'Plum', 'Sand', 'Slate', 'Blush', 'Indigo', 'Saffron',
];

const silk = await one(
  `INSERT INTO items (name, category, low_stock_qty) VALUES ($1,$2,$3) RETURNING id`,
  ['Silk', 'Kapda', null],
);
await query(`INSERT INTO item_units (item_id, unit, is_default) VALUES ($1,'meter',TRUE)`, [silk.id]);

const bulk = await one(
  `INSERT INTO purchases (vendor_id, bill_no, purchase_date, total_amount)
   VALUES ($1,$2,CURRENT_DATE,$3) RETURNING id`,
  [vendor.id, '403', 214500],
);
const bulkOut = await one(
  `INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark)
   VALUES ($1,'out',CURRENT_DATE,$2) RETURNING id`,
  [salim.id, 'Full lot for box lining'],
);

for (const [i, colour] of COLOURS.entries()) {
  const v = await one(
    `INSERT INTO item_variants (item_id, color) VALUES ($1,$2) RETURNING id`,
    [silk.id, colour],
  );
  const qty = 20 + (i % 7) * 5;
  await query(
    `INSERT INTO purchase_items (purchase_id, item_id, variant_id, unit, qty, rate, amount)
     VALUES ($1,$2,$3,'meter',$4,$5,$6)`,
    [bulk.id, silk.id, v.id, qty, 175, qty * 175],
  );
  await query(
    `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, vendor_id, moved_on)
     VALUES ($1,$2,'meter',$3,'purchase',$4,$5,CURRENT_DATE)`,
    [silk.id, v.id, qty, bulk.id, vendor.id],
  );

  // Thirty of the thirty-five colours go straight back out to a karigar.
  if (i < 30) {
    const out = qty - 5;
    // size carries the unit and design carries the colour — the same two boxes
    // the karigar form fills, so the demo matches what the app writes.
    await query(
      `INSERT INTO karigar_entry_lines (entry_id, item_id, size, design, qty)
       VALUES ($1,$2,'meter',$3,$4)`,
      [bulkOut.id, silk.id, colour, out],
    );
    await query(
      `INSERT INTO stock_movements (item_id, variant_id, unit, qty, reason, ref_id, moved_on)
       VALUES ($1,$2,'meter',$3,'karigar_out',$4,CURRENT_DATE)`,
      [silk.id, v.id, -out, bulkOut.id],
    );
  }
}

const summary = await one(`
  SELECT (SELECT count(*) FROM vendors)::int AS vendors,
         (SELECT count(*) FROM karigars)::int AS karigars,
         (SELECT count(*) FROM items)::int AS items,
         (SELECT count(*) FROM products)::int AS products,
         (SELECT count(*) FROM purchases WHERE purchase_date = CURRENT_DATE)::int AS purchases_today,
         (SELECT count(*) FROM payments WHERE pay_date = CURRENT_DATE)::int AS payments_today`);
console.log('seeded inventory_dev:', JSON.stringify(summary));
await pool.end();
