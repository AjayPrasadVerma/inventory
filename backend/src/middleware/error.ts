import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/http.js';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input',
      details: err.issues,
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Postgres unique violation
  if (typeof err === 'object' && err && (err as { code?: string }).code === '23505') {
    return res.status(409).json({ error: 'This record already exists (duplicate).' });
  }
  // Postgres foreign-key violation — record is referenced / referenced row missing
  if (typeof err === 'object' && err && (err as { code?: string }).code === '23503') {
    return res.status(409).json({ error: 'This record is in use and cannot be changed or removed.' });
  }
  // Postgres invalid input (bad number/date reaching the DB) and numeric overflow
  if (typeof err === 'object' && err && ['22P02', '22007', '22008', '22003'].includes((err as { code?: string }).code ?? '')) {
    return res.status(400).json({ error: 'Invalid value in request.' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Server error. Please try again shortly.' });
}
