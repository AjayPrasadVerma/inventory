import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { usersRepo } from '../modules/auth/users.repo.js';
import { AppError } from '../utils/http.js';

export type Role = 'owner' | 'staff';
export interface AuthUser {
  id: number;
  role: Role;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: env.jwtExpiresIn as any });
}

/**
 * What the account looks like now, not when the token was signed.
 *
 * A token is a snapshot that lives seven days, so on its own it would let a
 * removed user keep working for a week and would not notice a demotion until
 * they happened to log in again. Both are exactly what the user screen promises
 * to do, so the account is re-read here instead of trusted from the token.
 *
 * Cached briefly because this runs on every request: one query per user per TTL
 * rather than per call. Changes made on the user screen clear the entry
 * themselves (see forgetUser), so the delay only ever applies to a change made
 * somewhere else — straight in the database, or by another running instance.
 */
const ACCESS_TTL_MS = 30_000;
const accessCache = new Map<number, { at: number; access: { role: Role; name: string } | null }>();

/** Drop a cached account so the next request re-reads it immediately. */
export function forgetUser(id: number) {
  accessCache.delete(id);
}

async function currentAccess(id: number) {
  const hit = accessCache.get(id);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.access;
  const access = await usersRepo.currentAccess(id);
  accessCache.set(id, { at: Date.now(), access });
  return access;
}

/** Require a valid JWT for an account that is still active. Attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Please log in.');
  }
  let payload: jwt.JwtPayload & AuthUser;
  try {
    payload = jwt.verify(header.slice(7), env.jwtSecret) as jwt.JwtPayload & AuthUser;
  } catch {
    throw new AppError(401, 'Session expired, please log in again.');
  }
  // Express 4 does not catch a rejected promise from middleware, so this settles
  // itself rather than being written as an async function.
  currentAccess(payload.id)
    .then((live) => {
      if (!live) {
        next(new AppError(401, 'Your access has been removed. Please contact the owner.'));
        return;
      }
      // The live role wins: a demotion takes effect on the next request.
      req.user = { id: payload.id, role: live.role, name: live.name };
      next();
    })
    .catch(next);
}

/** Require one of the given roles (use after requireAuth). */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, 'You do not have permission for this.');
    }
    next();
  };
}
