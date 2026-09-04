import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required('JWT_SECRET'),
  /**
   * How long an access token lasts.
   *
   * 15 minutes, now that both clients refresh: the web frontend renews silently
   * on a 401 and repeats the request, and the mobile app is being written against
   * the same endpoint. A short lifetime is the point of having refresh tokens —
   * it is the window in which a stolen access token is worth anything, and unlike
   * a refresh token it cannot be revoked, only outlived.
   *
   * ACCESS_TOKEN_TTL is the name that means what it says. JWT_EXPIRES_IN is read
   * after it so a deployment still setting the old name keeps the lifetime it
   * has and picks the new default up only when that line goes.
   */
  jwtExpiresIn: process.env.ACCESS_TOKEN_TTL ?? process.env.JWT_EXPIRES_IN ?? '15m',
  /** How long a refresh token lasts. Rotation means this is the ceiling on being
   *  away from the app, not on the session: each use pushes it out again. */
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 90),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  seed: {
    ownerName: process.env.SEED_OWNER_NAME ?? 'Owner',
    ownerMobile: process.env.SEED_OWNER_MOBILE ?? '9999999999',
    ownerPassword: process.env.SEED_OWNER_PASSWORD ?? '', // required at seed time — no insecure default
  },
};

// A typo here would otherwise become NaN and land in the database as an expiry of
// "Invalid Date", where it reads as a token that can never be refreshed.
if (!Number.isFinite(env.refreshTokenTtlDays) || env.refreshTokenTtlDays <= 0) {
  throw new Error(
    `REFRESH_TOKEN_TTL_DAYS must be a positive number of days, got "${process.env.REFRESH_TOKEN_TTL_DAYS}".`,
  );
}
