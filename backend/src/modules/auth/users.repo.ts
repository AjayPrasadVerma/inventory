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
};
