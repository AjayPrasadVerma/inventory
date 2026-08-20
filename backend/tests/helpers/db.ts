/**
 * Test database harness.
 *
 * The project's dev DATABASE_URL points at the SAME Postgres the deployed app
 * uses. Tests truncate tables, so pointing them at that database would destroy
 * live data. Everything below exists to make that impossible rather than
 * unlikely: TEST_DATABASE_URL must be set, must differ from DATABASE_URL, and
 * must name a database that looks like a test database.
 */
import 'dotenv/config';

const PROD_URL = process.env.DATABASE_URL ?? '';
const TEST_URL = process.env.TEST_DATABASE_URL ?? '';

function dbName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

export function assertSafeTestDatabase(): void {
  if (!TEST_URL) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Tests refuse to run without an explicit test database, ' +
      'because they truncate tables and DATABASE_URL points at the live database.',
    );
  }
  if (PROD_URL && TEST_URL === PROD_URL) {
    throw new Error('TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run: that is the live database.');
  }
  const name = dbName(TEST_URL);
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL names database "${name}", which does not contain "test". ` +
      'Name it e.g. inventory_test so an accidental production URL cannot pass.',
    );
  }
  if (PROD_URL && dbName(PROD_URL) === name) {
    throw new Error('TEST_DATABASE_URL and DATABASE_URL name the same database. Refusing to run.');
  }
  // Point the app's own config at the test database before anything imports it.
  process.env.DATABASE_URL = TEST_URL;
}

assertSafeTestDatabase();

// Imported only AFTER the guard has redirected DATABASE_URL.
const { pool, query } = await import('../../src/config/db.js');
export { pool, query };

/** Apply every migration from scratch. Safe to call repeatedly. */
export async function migrate(): Promise<void> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');
  await query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name));
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    await query(await readFile(join(dir, file), 'utf8'));
    await query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
  }
}

/** Tables emptied between tests, children before parents. */
const TABLES = [
  'payments', 'sale_items', 'sales', 'job_receipts', 'job_issues', 'jobs',
  'purchase_items', 'purchases', 'finished_stock_movements', 'stock_movements',
  'product_variants', 'products', 'item_variants', 'item_units', 'items',
  'customers', 'karigars', 'vendors',
];

/** Wipe all business data. Users and _migrations survive. */
export async function reset(): Promise<void> {
  await query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
