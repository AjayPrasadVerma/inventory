import { createHash, randomBytes } from 'node:crypto';
import { query, withTransaction } from '../../config/db.js';

export interface RefreshTokenRow {
  id: string;
  user_id: number;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

/** 32 bytes of randomness, base64url. Long enough that guessing is not a threat
 *  model, which is why the stored hash can be a plain digest (see the migration). */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const refreshTokensRepo = {
  /** Store a freshly issued token. Takes the hash — the caller keeps the token. */
  async issue(userId: number, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRow> {
    const { rows } = await query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, tokenHash, expiresAt],
    );
    return rows[0]!;
  },

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const { rows } = await query<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  /**
   * Spend a token and issue its replacement, in one transaction.
   *
   * Both halves have to land together: revoking without issuing signs the user
   * out mid-request, and issuing without revoking leaves a token that can be
   * spent twice — which is the very thing rotation exists to make impossible.
   *
   * The revoke is conditional on the row still being unrevoked, so two refreshes
   * arriving together cannot both succeed: the second updates nothing, sees a
   * zero row count, and is reported as reuse.
   */
  async rotate(
    currentHash: string,
    next: { userId: number; tokenHash: string; expiresAt: Date },
  ): Promise<RefreshTokenRow | null> {
    return withTransaction(async (client) => {
      const spent = await client.query(
        `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [currentHash, next.tokenHash],
      );
      if ((spent.rowCount ?? 0) === 0) return null;

      const { rows } = await client.query<RefreshTokenRow>(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3) RETURNING *`,
        [next.userId, next.tokenHash, next.expiresAt],
      );
      return rows[0]!;
    });
  },

  /** End one session. Signing out, so already-revoked is success, not an error. */
  async revoke(tokenHash: string): Promise<boolean> {
    const res = await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * End every session a user has. This is what stops the refresh path quietly
   * undoing a removal: requireAuth re-reads the account so their access token
   * dies on its next request, and without this their refresh token would hand
   * them a new one for the next ninety days.
   */
  async revokeAllForUser(userId: number): Promise<number> {
    const res = await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return res.rowCount ?? 0;
  },

  /** Active sessions for a user — what a "signed in on 3 devices" count reads. */
  async activeCount(userId: number, now: Date = new Date()): Promise<number> {
    const { rows } = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [userId, now],
    );
    return Number(rows[0]!.n);
  },

  /**
   * Drop rows no decision depends on any more.
   *
   * Expired-and-revoked only. An expired row that was never revoked is kept for
   * now — deleting it would turn a replay of it from "reused" into "unknown", and
   * the difference is whether the user's other sessions get ended.
   */
  async deleteExpired(before: Date = new Date()): Promise<number> {
    const res = await query(
      'DELETE FROM refresh_tokens WHERE expires_at < $1 AND revoked_at IS NOT NULL',
      [before],
    );
    return res.rowCount ?? 0;
  },
};
