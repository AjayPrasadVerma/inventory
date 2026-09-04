/**
 * Refresh tokens — the long half of a mobile session.
 *
 * Three things are worth holding down here, and they are the three that would be
 * expensive to discover in the shop.
 *
 * One: rotation actually rotates. A refresh token is spent by using it, and the
 * replacement is issued in the same transaction. If either half could happen
 * without the other, a token would be usable twice, which is the thing rotation
 * exists to prevent.
 *
 * Two: a spent token presented again is treated as theft, not as a retry. It ends
 * every session the user has, because the server cannot tell the copy from the
 * original.
 *
 * Three, and this is the one MOBILE.md calls out: removing a user has to kill
 * their refresh token too. requireAuth re-reads the account so their access token
 * dies on the next request — but a live refresh token would hand them a new one
 * for the next ninety days, and the removal would be undone by the path nobody
 * was looking at.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, pool, query } from './helpers/db.js';
import { refreshOutcome } from '../src/modules/auth/refresh-policy.js';
import {
  hashRefreshToken,
  newRefreshToken,
  refreshTokensRepo,
} from '../src/modules/auth/refresh-tokens.repo.js';
import { usersRepo } from '../src/modules/auth/users.repo.js';

beforeAll(setupSchema);

/**
 * Its own slice of the reserved block CLAUDE.md §4 sets aside, so this file and
 * users.test.ts cannot clear each other's fixtures. Deleting the users takes the
 * refresh_tokens rows with them — the foreign key is ON DELETE CASCADE — so there
 * is nothing else to clean up.
 */
const LO = '9000000030';
const HI = '9000000049';

const clearFixtures = () =>
  query('DELETE FROM users WHERE mobile >= $1 AND mobile <= $2', [LO, HI]);

beforeEach(clearFixtures);
// Also at the end: the last test's rows would otherwise sit in the dev database
// and show up on the Users screen as logins nobody created.
afterAll(async () => {
  await clearFixtures();
  await pool.end();
});

let nextMobile = 30;
const make = (name = 'Phone User', role: 'owner' | 'staff' = 'staff') =>
  usersRepo.create({ name, mobile: `90000000${nextMobile++}`, passwordHash: 'x', role });

/** Issue a session the way the login route does, returning the raw token. */
async function issue(userId: number, ttlDays = 90) {
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await refreshTokensRepo.issue(userId, hashRefreshToken(token), expiresAt);
  return token;
}

beforeEach(() => { nextMobile = 30; });

describe('what a presented token is allowed to do', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it('allows a live, unrevoked token', () => {
    expect(refreshOutcome({ expires_at: future, revoked_at: null })).toEqual({ kind: 'ok' });
  });

  it('reports a token it has never seen', () => {
    expect(refreshOutcome(null).kind).toBe('unknown');
  });

  it('reports one that has simply run out', () => {
    expect(refreshOutcome({ expires_at: past, revoked_at: null }).kind).toBe('expired');
  });

  it('treats a spent token as reuse', () => {
    expect(refreshOutcome({ expires_at: future, revoked_at: past }).kind).toBe('reused');
  });

  it('calls a spent-and-expired token reuse, not expiry', () => {
    // Order matters: a replay is answered by ending the user's OTHER sessions,
    // and those are not expired. Reading this as plain expiry would leave the
    // stolen copy's siblings alive.
    expect(refreshOutcome({ expires_at: past, revoked_at: past }).kind).toBe('reused');
  });

  it('is exactly on the boundary, not a second either side', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(refreshOutcome({ expires_at: now, revoked_at: null }, now).kind).toBe('expired');
    expect(refreshOutcome({ expires_at: new Date(now.getTime() + 1), revoked_at: null }, now).kind)
      .toBe('ok');
  });

  it('says the same sentence however it failed', () => {
    // Whether a guessed token ever existed is not something the answer should
    // reveal, and the user does the same thing in every case: sign in again.
    const messages = new Set([
      refreshOutcome(null),
      refreshOutcome({ expires_at: past, revoked_at: null }),
      refreshOutcome({ expires_at: future, revoked_at: past }),
    ].map((o) => (o as { message: string }).message));
    expect(messages.size).toBe(1);
  });
});

describe('tokens themselves', () => {
  it('does not issue the same token twice', () => {
    const seen = new Set(Array.from({ length: 200 }, newRefreshToken));
    expect(seen.size).toBe(200);
  });

  it('hashes to something that is not the token', () => {
    const t = newRefreshToken();
    expect(hashRefreshToken(t)).not.toBe(t);
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t)); // same input, same hash
    expect(hashRefreshToken(t)).toHaveLength(64); // sha256, hex
  });

  it('stores the hash and never the token', async () => {
    const u = await make();
    const token = await issue(u.id);
    const { rows } = await query<{ token_hash: string }>(
      'SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [u.id],
    );
    expect(rows[0]!.token_hash).toBe(hashRefreshToken(token));
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
  });
});

describe('rotation', () => {
  it('spends the old token and issues a new one', async () => {
    const u = await make();
    const first = await issue(u.id);
    const second = newRefreshToken();

    const row = await refreshTokensRepo.rotate(hashRefreshToken(first), {
      userId: u.id, tokenHash: hashRefreshToken(second), expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(row).not.toBeNull();

    const spent = await refreshTokensRepo.findByHash(hashRefreshToken(first));
    expect(spent!.revoked_at).not.toBeNull();
    expect(spent!.replaced_by).toBe(hashRefreshToken(second));

    // And the replacement is usable.
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(second))).kind)
      .toBe('ok');
  });

  it('refuses to spend the same token twice', async () => {
    const u = await make();
    const first = await issue(u.id);

    const ok = await refreshTokensRepo.rotate(hashRefreshToken(first), {
      userId: u.id, tokenHash: hashRefreshToken(newRefreshToken()), expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(ok).not.toBeNull();

    // Second use: no replacement is issued, and the route reads this null as reuse.
    const again = await refreshTokensRepo.rotate(hashRefreshToken(first), {
      userId: u.id, tokenHash: hashRefreshToken(newRefreshToken()), expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(again).toBeNull();
  });

  it('lets only one of two simultaneous refreshes win', async () => {
    const u = await make();
    const first = await issue(u.id);
    const attempt = () => refreshTokensRepo.rotate(hashRefreshToken(first), {
      userId: u.id, tokenHash: hashRefreshToken(newRefreshToken()), expiresAt: new Date(Date.now() + 86_400_000),
    });

    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('does not leave a replacement behind when it loses', async () => {
    // The two halves are one transaction, so a lost race must issue nothing —
    // otherwise the table grows a token whose parent was never spent for it.
    const u = await make();
    const first = await issue(u.id);
    await refreshTokensRepo.rotate(hashRefreshToken(first), {
      userId: u.id, tokenHash: hashRefreshToken(newRefreshToken()), expiresAt: new Date(Date.now() + 86_400_000),
    });

    const orphan = newRefreshToken();
    await refreshTokensRepo.rotate(hashRefreshToken(first), {
      userId: u.id, tokenHash: hashRefreshToken(orphan), expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await refreshTokensRepo.findByHash(hashRefreshToken(orphan))).toBeNull();
  });
});

describe('ending sessions', () => {
  it('revokes one session and leaves the others signed in', async () => {
    const u = await make();
    const phone = await issue(u.id);
    const tablet = await issue(u.id);

    expect(await refreshTokensRepo.revoke(hashRefreshToken(phone))).toBe(true);
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(phone))).kind)
      .toBe('reused');
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(tablet))).kind)
      .toBe('ok');
  });

  it('treats signing out twice as done, not as an error', async () => {
    const u = await make();
    const token = await issue(u.id);
    expect(await refreshTokensRepo.revoke(hashRefreshToken(token))).toBe(true);
    expect(await refreshTokensRepo.revoke(hashRefreshToken(token))).toBe(false);
  });

  it('ends every session a user has, and nobody else\'s', async () => {
    const u = await make();
    const other = await make('Someone Else');
    const mine = [await issue(u.id), await issue(u.id), await issue(u.id)];
    const theirs = await issue(other.id);

    expect(await refreshTokensRepo.revokeAllForUser(u.id)).toBe(3);
    for (const t of mine) {
      expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(t))).kind)
        .toBe('reused');
    }
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(theirs))).kind)
      .toBe('ok');
  });

  it('counts active sessions, ignoring revoked and expired ones', async () => {
    const u = await make();
    const live = await issue(u.id);
    await issue(u.id, -1); // already expired
    const gone = await issue(u.id);
    await refreshTokensRepo.revoke(hashRefreshToken(gone));

    expect(await refreshTokensRepo.activeCount(u.id)).toBe(1);
    await refreshTokensRepo.revoke(hashRefreshToken(live));
    expect(await refreshTokensRepo.activeCount(u.id)).toBe(0);
  });
});

describe('removing a user kills the refresh path too', () => {
  it('leaves a removed user with no live access and no usable token', async () => {
    // What the PATCH route does, in the order it does it. Both halves matter:
    // currentAccess going null is what stops requireAuth and what makes the
    // refresh route refuse; revoking is what stops the token outliving that.
    const u = await make();
    const token = await issue(u.id);
    expect(await usersRepo.currentAccess(u.id)).toMatchObject({ role: 'staff' });
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(token))).kind)
      .toBe('ok');

    await usersRepo.update(u.id, { is_active: false });
    await refreshTokensRepo.revokeAllForUser(u.id);

    expect(await usersRepo.currentAccess(u.id)).toBeNull();
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(token))).kind)
      .not.toBe('ok');
  });

  it('does not hand a restored user their old sessions back', async () => {
    // Restoring makes the account usable again; it does not un-revoke tokens that
    // were ended while it was removed. They sign in again, which is the point.
    const u = await make();
    const token = await issue(u.id);
    await usersRepo.update(u.id, { is_active: false });
    await refreshTokensRepo.revokeAllForUser(u.id);
    await usersRepo.update(u.id, { is_active: true });

    expect(await usersRepo.currentAccess(u.id)).toMatchObject({ role: 'staff' });
    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(token))).kind)
      .toBe('reused');
  });

  it('carries a demotion into the next access token', async () => {
    // A demotion deliberately does NOT end the session — the refresh route reads
    // the role from the live row, so the smaller role is already in force.
    const u = await make('Was Owner', 'owner');
    const token = await issue(u.id);
    await usersRepo.update(u.id, { role: 'staff' });

    expect(refreshOutcome(await refreshTokensRepo.findByHash(hashRefreshToken(token))).kind)
      .toBe('ok');
    expect(await usersRepo.currentAccess(u.id)).toMatchObject({ role: 'staff' });
  });
});

describe('housekeeping', () => {
  it('deletes spent expired rows and keeps expired ones that were never spent', async () => {
    const u = await make();
    const spent = await issue(u.id, -1);
    await refreshTokensRepo.revoke(hashRefreshToken(spent));
    const lapsed = await issue(u.id, -1);
    const live = await issue(u.id);

    await refreshTokensRepo.deleteExpired();

    expect(await refreshTokensRepo.findByHash(hashRefreshToken(spent))).toBeNull();
    // Kept on purpose: deleting it would turn a replay of it from "reused" into
    // "unknown", and the difference is whether the user's other sessions end.
    expect(await refreshTokensRepo.findByHash(hashRefreshToken(lapsed))).not.toBeNull();
    expect(await refreshTokensRepo.findByHash(hashRefreshToken(live))).not.toBeNull();
  });
});
