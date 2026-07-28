# ── Stage 1: Install dependencies (incl. tsx, which runs the server) ──────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: Production runner ────────────────────────────────────────────────
# The API runs TypeScript directly via tsx (no build step), so we ship node_modules
# (which includes tsx) plus the source. Migrations run via `npm run migrate`.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

COPY --from=deps /app/node_modules ./node_modules
COPY . .

USER appuser
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["npm", "start"]
