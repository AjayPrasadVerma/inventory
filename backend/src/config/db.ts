import pg from 'pg';
import { env } from './env.js';

// Return DATE (oid 1082) as a plain 'YYYY-MM-DD' string instead of a JS Date,
// so JSON responses don't apply a timezone shift (which showed the wrong day).
pg.types.setTypeParser(1082, (v) => v);

// Neon and most cloud Postgres need SSL; local usually does not.
const needsSsl = /\bsslmode=require\b/.test(env.databaseUrl) || /neon\.tech/.test(env.databaseUrl);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  // Fail fast on a slow/flaky link instead of hanging forever waiting for a
  // connection, and cap any single runaway query so it can't hold a connection.
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

/** Run a parameterized query. NEVER build SQL by string concatenation — always use $1, $2 … */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}

/** Run a set of statements inside a single transaction. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
