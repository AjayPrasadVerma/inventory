import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireRole, signToken } from '../../middleware/auth.js';
import { AppError, asyncHandler } from '../../utils/http.js';
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
