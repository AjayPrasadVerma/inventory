import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';

async function run() {
  const { ownerName, ownerMobile, ownerPassword } = env.seed;
  if (!ownerPassword || ownerPassword.length < 8) {
    throw new Error('Set SEED_OWNER_PASSWORD (min 8 chars) in .env before seeding — there is no default.');
  }
  const existing = await pool.query('SELECT id FROM users WHERE mobile = $1', [ownerMobile]);

  if (existing.rowCount && existing.rowCount > 0) {
    console.log(`Owner (${ownerMobile}) already exists — nothing to seed.`);
  } else {
    const hash = await bcrypt.hash(ownerPassword, 10);
    await pool.query(
      `INSERT INTO users (name, mobile, password_hash, role) VALUES ($1, $2, $3, 'owner')`,
      [ownerName, ownerMobile, hash],
    );
    // Never log the actual password (it would leak into deploy logs).
    console.log(`✓ Owner created — mobile: ${ownerMobile}`);
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
