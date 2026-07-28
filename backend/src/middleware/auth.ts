import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
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

/** Require a valid JWT. Attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Please log in.');
  }
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as jwt.JwtPayload & AuthUser;
    req.user = { id: payload.id, role: payload.role, name: payload.name };
    next();
  } catch {
    throw new AppError(401, 'Session expired, please log in again.');
  }
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
