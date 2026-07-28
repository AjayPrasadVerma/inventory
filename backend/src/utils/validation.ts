import { z } from 'zod';

/** A positive integer id (path params, foreign keys). Throws a clean 400 on junk like "abc"/"NaN"/"-1". */
export const idSchema = z.coerce.number().int().positive();

/** Parse a route :id param → positive int, or throw a ZodError (mapped to 400 by the error handler). */
export function parseId(value: unknown): number {
  return idSchema.parse(value);
}

/**
 * A strict ISO calendar date string (YYYY-MM-DD) for DATE columns.
 * Kept as a string (not coerced to Date) so it maps 1:1 to the DATE column with no timezone shift.
 */
export const dateStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date (YYYY-MM-DD)')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');

/** A transactional date that may not be in the future (sales, purchases, issues, payments). */
export const pastOrTodayDateSchema = dateStringSchema.refine((s) => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return s <= todayStr;
}, 'Date cannot be in the future');
