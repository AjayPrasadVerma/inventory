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

/**
 * Retry a step that only fails because the link blipped. CI runs Postgres on the
 * same machine and never needs this; a remote test database on a flaky link does,
 * and a dropped socket is not a test failure.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/terminated|timeout|ECONNRESET|ECONNREFUSED|deadlock/i.test(msg)) throw err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${last instanceof Error ? last.message : last}`);
}

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

/** Everything a test writes: documents and the stock/money they move. Cleared
 *  between tests. Children before parents so no CASCADE is needed. */
const TXN_TABLES = [
  'payments', 'sale_items', 'sales', 'job_receipts', 'job_issues', 'jobs',
  'karigar_entry_lines', 'karigar_entries',
  'purchase_items', 'purchases', 'finished_stock_movements', 'stock_movements',
];

/** The catalogue. Seeded once per file, not per test — truncating it needs heavy
 *  locks on tables everything references, which is both slow and deadlock-prone. */
const CATALOGUE_TABLES = [
  'product_variants', 'products', 'item_variants', 'item_units', 'items',
  'customers', 'karigars', 'vendors',
];

/**
 * TRUNCATE takes ACCESS EXCLUSIVE, so a connection left over from the previous
 * test file can turn this into a deadlock. One dedicated connection, a short
 * lock_timeout so it fails fast instead of hanging, and one retry.
 */
async function truncate(tables: string[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('SET LOCAL lock_timeout = \'5s\'');
      await client.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY`);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    } finally {
      client.release();
    }
  }
}

/** Clear what a test wrote, keeping the catalogue. Call in beforeEach. */
export async function resetTransactions(): Promise<void> {
  await withRetry('resetTransactions', () => truncate(TXN_TABLES));
}

/** Wipe all business data including the catalogue. Call once, in beforeAll. */
export async function reset(): Promise<void> {
  await withRetry('reset', () => truncate([...TXN_TABLES, ...CATALOGUE_TABLES]));
}

/** migrate + reset + seed, retried past a blipping link. Use in beforeAll. */
export async function setupSchema(): Promise<void> {
  await withRetry('migrate', migrate);
  await reset();
}
