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
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
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
