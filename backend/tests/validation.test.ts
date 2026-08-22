/**
 * Date validation. `Date.parse` ROLLS OVER an impossible day — "2026-02-30"
 * becomes 2 March and used to pass — so the schema accepted it and Postgres
 * then 500'd on the literal. dateStringSchema backs every date-range report,
 * so one bad query string broke them all.
 */
import { describe, expect, it } from 'vitest';
import { dateStringSchema, pastOrTodayDateSchema } from '../src/utils/validation.js';

const accepts = (s: string) => dateStringSchema.safeParse(s).success;

describe('dateStringSchema', () => {
  it('rejects days that do not exist in that month', () => {
    expect(accepts('2026-02-30')).toBe(false);
    expect(accepts('2026-04-31')).toBe(false);
    expect(accepts('2026-06-31')).toBe(false);
  });

  it('knows which years are leap years', () => {
    expect(accepts('2024-02-29')).toBe(true);   // divisible by 4
    expect(accepts('2026-02-29')).toBe(false);  // not
    expect(accepts('2000-02-29')).toBe(true);   // century divisible by 400
    expect(accepts('1900-02-29')).toBe(false);  // century not divisible by 400
  });

  it('still rejects the obviously malformed', () => {
    for (const bad of ['2026-13-01', '2026-08-32', '2026-00-10', '2026-8-1', '', 'today', '2026-08-20T00:00:00Z']) {
      expect(accepts(bad), bad).toBe(false);
    }
  });

  it('accepts real dates, including month and year ends', () => {
    for (const good of ['2026-01-31', '2026-02-28', '2026-12-31', '2020-01-01', '2026-04-30']) {
      expect(accepts(good), good).toBe(true);
    }
  });

  it('rejects year zero, which Postgres cannot store either', () => {
    expect(accepts('0000-01-01')).toBe(false);
  });
});

describe('pastOrTodayDateSchema', () => {
  it('inherits the calendar check rather than only looking at the future', () => {
    expect(pastOrTodayDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(pastOrTodayDateSchema.safeParse('2099-12-31').success).toBe(false);
    expect(pastOrTodayDateSchema.safeParse('2020-06-15').success).toBe(true);
  });
});
