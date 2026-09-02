/**
 * The user module. Two things are worth holding down here.
 *
 * One: an owner must not be able to lock the shop out of its own app. There is
 * no reset mail and no console, so the only way back would be editing the
 * database on the server by hand.
 *
 * Two: a token is a seven-day snapshot. Removing a user or changing their role
 * has to take effect on their next request, not whenever they next log in — that
 * is the whole promise the screen makes.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { setupSchema, pool, query } from './helpers/db.js';
import { accessChangeProblem } from '../src/modules/auth/user-access.js';
import { usersRepo } from '../src/modules/auth/users.repo.js';

beforeAll(setupSchema);
// users is neither transaction data nor catalogue, so the shared helpers leave
// it alone and this file clears it itself. DELETE rather than TRUNCATE CASCADE:
// five tables carry a created_by, so the cascade would take ACCESS EXCLUSIVE on
// most of the schema — the deadlock the helpers go out of their way to avoid —
// to clear rows nothing here ever creates.
beforeEach(async () => { await query('DELETE FROM users'); });
afterAll(async () => { await pool.end(); });

const make = (name: string, mobile: string, role: 'owner' | 'staff' = 'staff') =>
  usersRepo.create({ name, mobile, passwordHash: 'x', role });

describe('locking yourself out', () => {
  const target = { id: 2, role: 'owner' as const };

  it('refuses to let an owner remove their own access', () => {
    expect(accessChangeProblem({
      actorId: 2, target, input: { is_active: false }, otherActiveOwners: 5,
    })).toMatch(/your own access/i);
  });

  it('refuses to let an owner demote themselves', () => {
    expect(accessChangeProblem({
      actorId: 2, target, input: { role: 'staff' }, otherActiveOwners: 5,
    })).toMatch(/your own access/i);
  });

  it('refuses to remove the last owner', () => {
    expect(accessChangeProblem({
      actorId: 1, target, input: { is_active: false }, otherActiveOwners: 0,
    })).toMatch(/only owner/i);
  });

  it('allows removing an owner while another one remains', () => {
    expect(accessChangeProblem({
      actorId: 1, target, input: { is_active: false }, otherActiveOwners: 1,
    })).toBeNull();
  });

  it('allows removing staff, and does not count staff as a last owner', () => {
    expect(accessChangeProblem({
      actorId: 1, target: { id: 2, role: 'staff' }, input: { is_active: false }, otherActiveOwners: 0,
    })).toBeNull();
  });

  it('leaves a plain rename alone even for the last owner', () => {
    expect(accessChangeProblem({
      actorId: 1, target, input: {}, otherActiveOwners: 0,
    })).toBeNull();
  });
});

describe('otherActiveOwners', () => {
  it('counts only active owners, and never the user being changed', async () => {
    const a = await make('Owner A', '9000000001', 'owner');
    const b = await make('Owner B', '9000000002', 'owner');
    const c = await make('Owner C', '9000000003', 'owner');
    await make('Staff', '9000000004', 'staff');
    await usersRepo.update(c.id, { is_active: false });

    expect(await usersRepo.otherActiveOwners(a.id)).toBe(1); // B only: C removed, staff is not an owner
    expect(await usersRepo.otherActiveOwners(b.id)).toBe(1);
  });
});

describe('a change takes effect without waiting for a new token', () => {
  it('stops reporting access once the user is removed', async () => {
    const u = await make('Staff', '9000000005');
    expect(await usersRepo.currentAccess(u.id)).toMatchObject({ role: 'staff' });

    await usersRepo.update(u.id, { is_active: false });
    expect(await usersRepo.currentAccess(u.id)).toBeNull();

    await usersRepo.update(u.id, { is_active: true });
    expect(await usersRepo.currentAccess(u.id)).toMatchObject({ role: 'staff' });
  });

  it('reports the new role, which is what the request is then allowed to do', async () => {
    const u = await make('Staff', '9000000006');
    await usersRepo.update(u.id, { role: 'owner' });
    expect(await usersRepo.currentAccess(u.id)).toMatchObject({ role: 'owner' });
  });
});

describe('update', () => {
  it('leaves out what was not sent instead of resetting it', async () => {
    const u = await make('Old Name', '9000000007', 'owner');
    const after = await usersRepo.update(u.id, { name: 'New Name' });
    expect(after).toMatchObject({ name: 'New Name', mobile: '9000000007', role: 'owner', is_active: true });
  });

  it('never returns the password hash', async () => {
    const u = await make('Staff', '9000000008');
    expect(await usersRepo.update(u.id, { name: 'Renamed' })).not.toHaveProperty('password_hash');
    expect(await usersRepo.publicById(u.id)).not.toHaveProperty('password_hash');
    expect(await usersRepo.list()).not.toContainEqual(expect.objectContaining({ password_hash: expect.anything() }));
  });

  it('changes the password without touching anything else', async () => {
    const u = await make('Staff', '9000000009');
    expect(await usersRepo.setPassword(u.id, 'new-hash')).toBe(true);
    const row = await usersRepo.findById(u.id);
    expect(row).toMatchObject({ password_hash: 'new-hash', name: 'Staff', mobile: '9000000009' });
  });

  it('reports a miss rather than pretending to have written', async () => {
    expect(await usersRepo.setPassword(9999, 'h')).toBe(false);
    expect(await usersRepo.update(9999, { name: 'Ghost' })).toBeNull();
  });
});

describe('mobile is the login name', () => {
  it('keeps a removed user findable, so their number reads as taken', async () => {
    const u = await make('Gone', '9000000010');
    await usersRepo.update(u.id, { is_active: false });
    // The list shows removed users too, so the owner can see who holds it.
    expect(await usersRepo.findByMobile('9000000010')).toMatchObject({ name: 'Gone', is_active: false });
    expect(await usersRepo.list()).toContainEqual(expect.objectContaining({ name: 'Gone', is_active: false }));
  });
});
