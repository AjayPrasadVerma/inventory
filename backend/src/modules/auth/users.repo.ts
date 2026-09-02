import { query } from '../../config/db.js';

export interface UserRow {
  id: number;
  name: string;
  mobile: string;
  password_hash: string;
  role: 'owner' | 'staff';
  is_active: boolean;
  created_at: string;
}

export const usersRepo = {
  async findByMobile(mobile: string): Promise<UserRow | null> {
    const { rows } = await query<UserRow>('SELECT * FROM users WHERE mobile = $1', [mobile]);
    return rows[0] ?? null;
  },

  async findById(id: number): Promise<UserRow | null> {
    const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async create(input: {
    name: string;
    mobile: string;
    passwordHash: string;
    role: 'owner' | 'staff';
  }): Promise<UserRow> {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (name, mobile, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.name, input.mobile, input.passwordHash, input.role],
    );
    return rows[0]!;
  },

  async list(): Promise<Omit<UserRow, 'password_hash'>[]> {
    const { rows } = await query<UserRow>(
      'SELECT id, name, mobile, role, is_active, created_at FROM users ORDER BY created_at',
    );
    return rows;
  },

  /**
   * What the token cannot know: whether this account is still active and what
   * role it holds now. A JWT is a snapshot, so without this a removed user keeps
   * working until their token expires and a demotion does not take effect until
   * they happen to log in again.
   */
  async currentAccess(id: number): Promise<{ role: 'owner' | 'staff'; name: string } | null> {
    const { rows } = await query<{ role: 'owner' | 'staff'; name: string }>(
      'SELECT role, name FROM users WHERE id = $1 AND is_active',
      [id],
    );
    return rows[0] ?? null;
  },

  /** Active owners other than the one given — the last one may not be removed. */
  async otherActiveOwners(excludeId: number): Promise<number> {
    const { rows } = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM users
       WHERE role = 'owner' AND is_active AND id <> $1`,
      [excludeId],
    );
    return Number(rows[0]!.n);
  },

  async update(id: number, input: {
    name?: string;
    mobile?: string;
    role?: 'owner' | 'staff';
    is_active?: boolean;
  }): Promise<Omit<UserRow, 'password_hash'> | null> {
    // Built from what was actually sent, so an omitted field is left alone
    // rather than overwritten with a default.
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [col, val] of Object.entries(input)) {
      if (val === undefined) continue;
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length === 0) return this.publicById(id);

    const { rows } = await query<UserRow>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, name, mobile, role, is_active, created_at`,
      vals,
    );
    return rows[0] ?? null;
  },

  async setPassword(id: number, passwordHash: string): Promise<boolean> {
    const res = await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
    return (res.rowCount ?? 0) > 0;
  },

  async publicById(id: number): Promise<Omit<UserRow, 'password_hash'> | null> {
    const { rows } = await query<UserRow>(
      'SELECT id, name, mobile, role, is_active, created_at FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  },
};
