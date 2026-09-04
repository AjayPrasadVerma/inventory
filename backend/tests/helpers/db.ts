/**
 * Test database harness.
 *
 * The suite TRUNCATES tables, so where it points is a safety question, not a
 * configuration detail.
 *
 * It used to demand a separate TEST_DATABASE_URL naming a database with "test"
 * in it. Keeping a second database in step was more setup than it was worth for
 * one developer on two machines, so the tests now fall back to DATABASE_URL —
 * the dev database — when no test URL is given. **Running them wipes whatever
 * that database holds.** That is the accepted trade: dev data is disposable.
 *
 * One rule survives, and it is the one that matters: the suite refuses to touch
 * production. Dev and production sit on the same Postgres host, so the host
 * cannot tell them apart and the database NAME is the only thing that can.
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

/** The database the suite must never open. Exact match: "inventory_dev" and
 *  "inventory_test" both start with it and are both fine to wipe. */
const PRODUCTION_DB = 'inventory';

export function assertSafeTestDatabase(): void {
  // TEST_DATABASE_URL still wins when it is set — CI points it at a throwaway
  // Postgres on the runner. Locally it is usually absent and the dev database
  // is used instead.
  const url = TEST_URL || PROD_URL;
  if (!url) {
    throw new Error(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set. Copy backend/.env.example ' +
      'to backend/.env and point DATABASE_URL at your development database.',
    );
  }

  const name = dbName(url);
  if (name === PRODUCTION_DB) {
    throw new Error(
      `Refusing to run: that URL names "${PRODUCTION_DB}", which is production — the database ` +
      'https://inventory.acronix.in serves. The suite truncates tables, so this would destroy ' +
      'the shop\'s real data. Point DATABASE_URL at inventory_dev.',
    );
  }

  // Loud, because this is destructive and easy to forget once it is routine.
  if (!/test/i.test(name)) {
    console.warn(
      `\n  ⚠  Tests will TRUNCATE tables in "${name}". Everything in it will be gone.\n`,
    );
  }

  // Point the app's own config at it before anything imports the pool.
  process.env.DATABASE_URL = url;
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
