import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name),
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ applied ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ failed ${file}:`, (err as Error).message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? 'Already up to date.' : `Done. ${count} migration(s) applied.`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
