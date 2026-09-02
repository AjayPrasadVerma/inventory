import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { forgetUser, requireAuth, requireRole, signToken } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
import { parseId } from '../../utils/validation.js';
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
    res.json({ token: signToken(authUser), user: authUser });
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
    res.json({ ok: true });
  }),
);
