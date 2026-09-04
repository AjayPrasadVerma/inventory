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
   * ACCESS_TOKEN_TTL is the name that means what it says; JWT_EXPIRES_IN is read
   * after it so the deployments already setting that keep the lifetime they have.
   * The fallback stays '7d' for the same reason — shortening it is a decision
   * someone makes, not something a deploy does on its own.
   *
   * It should be short (15m) once every client can refresh. The web frontend
   * cannot yet: it treats any 401 as the end of the session and returns to the
   * login screen, so a short lifetime here would sign the shop out mid-afternoon.
   * See MOBILE.md.
   */
  jwtExpiresIn: process.env.ACCESS_TOKEN_TTL ?? process.env.JWT_EXPIRES_IN ?? '7d',
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
