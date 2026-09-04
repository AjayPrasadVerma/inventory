import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { AuthUser } from '../../middleware/auth.js';
import { forgetUser, requireAuth, requireRole, signToken } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
import { refreshOutcome } from './refresh-policy.js';
import { hashRefreshToken, newRefreshToken, refreshTokensRepo } from './refresh-tokens.repo.js';
import { accessChangeProblem } from './user-access.js';
import { usersRepo } from './users.repo.js';

export const authRouter = Router();

// Throttle login attempts to blunt password brute-forcing (per IP).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

/**
 * Refresh is not a guessing target the way login is — a refresh token is 256 bits
 * of randomness, not a password someone might have chosen badly. This is here to
 * cap a client stuck in a retry loop, so the limit is generous: the whole shop
 * shares one IP, and every phone refreshes on a timer.
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Please wait a few minutes and try again.' },
});

function refreshExpiry(): Date {
  return new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

/**
 * The pair handed to a client, plus the row that lets the long half be taken back.
 *
 * `token` is the access token under its old name. The web frontend reads exactly
 * that field, and this is deployed by merging, so renaming it would sign everyone
 * out at the moment of the deploy. `accessToken` is the name the Dart models will
 * use; both carry the same value and the alias goes once the web reads the new one.
 */
async function issueSession(user: AuthUser) {
  const refreshToken = newRefreshToken();
  await refreshTokensRepo.issue(user.id, hashRefreshToken(refreshToken), refreshExpiry());
  const accessToken = signToken(user);
  return { token: accessToken, accessToken, refreshToken, user };
}

const loginSchema = z.object({
  mobile: z.string().trim().min(1, 'Enter mobile number'),
  password: z.string().min(1, 'Enter password'),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { mobile, password } = loginSchema.parse(req.body);
    const user = await usersRepo.findByMobile(mobile);
    if (!user || !user.is_active) throw new AppError(401, 'Incorrect mobile number or password.');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new AppError(401, 'Incorrect mobile number or password.');

    const authUser = { id: user.id, role: user.role, name: user.name };
    res.json(await issueSession(authUser));
  }),
);

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1, 'Missing refresh token'),
});

/**
 * Trade a refresh token for a new pair.
 *
 * This is the path that could quietly undo the user screen, so it makes the same
 * check requireAuth makes: the account is re-read here, live, and a removed or
 * deactivated user is refused and has every session ended. Without that, removing
 * someone would stop their next request and then hand them a fresh token a minute
 * later, for as long as the refresh token lasted.
 *
 * Deliberately not behind requireAuth. The whole point of arriving here is that
 * the access token has expired; demanding a live one would make refresh work only
 * while it was not yet needed.
 */
authRouter.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const presentedHash = hashRefreshToken(refreshToken);
    const row = await refreshTokensRepo.findByHash(presentedHash);

    const outcome = refreshOutcome(row);
    if (outcome.kind !== 'ok') {
      // A token presented after it was spent means a copy of it exists. Which
      // holder is the thief is unknowable, so both are signed out.
      if (outcome.kind === 'reused' && row) await refreshTokensRepo.revokeAllForUser(row.user_id);
      throw new AppError(401, outcome.message);
    }

    const live = await usersRepo.currentAccess(row!.user_id);
    if (!live) {
      await refreshTokensRepo.revokeAllForUser(row!.user_id);
      throw new AppError(401, 'Your access has been removed. Please contact the owner.');
    }

    // Name and role come from the row just read, not from the expired token, so a
    // rename or a demotion is already in the new access token rather than waiting
    // for requireAuth to correct it on the next request.
    const authUser: AuthUser = { id: row!.user_id, role: live.role, name: live.name };
    const next = newRefreshToken();
    const rotated = await refreshTokensRepo.rotate(presentedHash, {
      userId: authUser.id,
      tokenHash: hashRefreshToken(next),
      expiresAt: refreshExpiry(),
    });
    // Lost the race against a refresh that arrived at the same moment. The other
    // one spent the token, so this is a second use of it like any other.
    if (!rotated) {
      await refreshTokensRepo.revokeAllForUser(authUser.id);
      throw new AppError(401, 'Your session has ended. Please sign in again.');
    }

    const accessToken = signToken(authUser);
    res.json({ token: accessToken, accessToken, refreshToken: next, user: authUser });
  }),
);

/**
 * Sign out, ending this one session.
 *
 * No requireAuth here either: signing out has to work with a dead access token,
 * which is exactly when someone reaches for it. The refresh token is itself the
 * proof of which session to end, and holding it is the only thing being claimed.
 *
 * Always answers ok. Whether that token existed is not the caller's business, and
 * a client that has already discarded its tokens should not see an error for
 * tidying up.
 */
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) await refreshTokensRepo.revoke(hashRefreshToken(parsed.data.refreshToken));
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

// Owner can add staff / other users.
const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mobile: z.string().trim().regex(/^\d{7,15}$/, 'Enter a valid mobile number'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  role: z.enum(['owner', 'staff']).default('staff'),
});

authRouter.post(
  '/users',
  requireAuth,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    // The mobile is the login name, so a clash is the one mistake worth naming
    // precisely: a removed account still holds its number, and "duplicate" alone
    // sends the owner looking for a user the list is not showing.
    const taken = await usersRepo.findByMobile(input.mobile);
    if (taken) {
      throw new AppError(409, taken.is_active
        ? `${taken.name} already uses this mobile number.`
        : `${taken.name} used this mobile number and was removed. Restore that user instead.`);
    }
    const hash = await bcrypt.hash(input.password, 10);
    const user = await usersRepo.create({
      name: input.name,
      mobile: input.mobile,
      passwordHash: hash,
      role: input.role,
    });
    res.status(201).json({ user: { id: user.id, name: user.name, mobile: user.mobile, role: user.role } });
  }),
);

authRouter.get(
  '/users',
  requireAuth,
  requireRole('owner'),
  asyncHandler(async (_req, res) => {
    res.json({ users: await usersRepo.list() });
  }),
);

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  mobile: z.string().trim().regex(/^\d{7,15}$/, 'Enter a valid mobile number').optional(),
  role: z.enum(['owner', 'staff']).optional(),
  is_active: z.boolean().optional(),
});

/**
 * Edit a user, including removing and restoring one.
 *
 * Two ways an owner could lock the shop out of its own app, both refused here:
 * taking away their own access — the request would succeed and the next one would
 * not — and removing or demoting the last owner, after which nobody could reach
 * this screen to undo it.
 */
authRouter.patch(
  '/users/:id',
  requireAuth,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const input = updateUserSchema.parse(req.body);
    const target = await usersRepo.findById(id);
    if (!target) throw new AppError(404, 'User not found.');

    const problem = accessChangeProblem({
      actorId: req.user!.id,
      target: { id: target.id, role: target.role },
      input,
      otherActiveOwners: await usersRepo.otherActiveOwners(id),
    });
    if (problem) throw new AppError(409, problem);

    if (input.mobile && input.mobile !== target.mobile) {
      const taken = await usersRepo.findByMobile(input.mobile);
      if (taken) throw new AppError(409, `${taken.name} already uses this mobile number.`);
    }

    const user = await usersRepo.update(id, input);
    forgetUser(id); // so a removal or a demotion bites on their very next request
    // …and so it stays bitten. Their access token dies on the next request because
    // requireAuth re-reads the account; their refresh token would otherwise still
    // buy a new one for the next ninety days, which is the removal undone.
    //
    // Only on removal. A demotion needs nothing here: both requireAuth and the
    // refresh route take the role from the live row, so the smaller role is
    // already in force and ending the session as well would just be noise.
    if (input.is_active === false) await refreshTokensRepo.revokeAllForUser(id);
    res.json({ user });
  }),
);

const passwordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

/** Set someone's password. The owner hands out the new one — there is no email
 *  or SMS here to send a reset link through. */
authRouter.post(
  '/users/:id/password',
  requireAuth,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { password } = passwordSchema.parse(req.body);
    if (!(await usersRepo.findById(id))) throw new AppError(404, 'User not found.');
    await usersRepo.setPassword(id, await bcrypt.hash(password, 10));
    // A password is changed either because the old one is being retired or
    // because it is suspected of having leaked. In both readings the sessions
    // opened with it should not outlive it, and on a phone one of those sessions
    // could otherwise sit signed in for months.
    const ended = await refreshTokensRepo.revokeAllForUser(id);
    res.json({ ok: true, sessionsEnded: ended });
  }),
);
