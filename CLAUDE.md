# Claude instructions for Diamond Box Wala

These rules apply to every session in this repo. Read them before doing anything else.

## 1. Branching — only `claude/features`

**Never create a new branch.** All work goes on `claude/features` — stack commits there.

- If you find yourself on `master` or any other branch, stop and switch to `claude/features` before making changes.
- PRs go `claude/features` → **`master`**, never onto another feature branch.
- After a merge, sync `claude/features` back to `master` rather than starting a fresh branch.
- **Before creating any PR, check what already exists** (`gh pr list --head claude/features --state all`). If one is open, push onto it instead of opening a duplicate. If the last one was merged, first re-sync to `origin/master` and re-apply only the un-merged commits, or the new PR shows a noisy diff. Never blindly `gh pr create`.
- **Never open a PR whose base is another feature branch.** GitHub only retargets a stacked PR when its base branch is *deleted*; otherwise merging it puts the commits on a branch `master` has already moved past, and they look merged while never reaching production. This has happened here — PR #4 merged into `feat/dashboard-day-activity` and four commits silently missed the deploy.

One branch, one history. Per-feature branches cost real time to reconcile.

## 2. `master` is production

A push to `master` triggers `.github/workflows/deploy.yml`, which builds images, pushes to GHCR and blue-green deploys to **https://inventory.acronix.in**. There is no staging.

- Never push or commit directly to `master`.
- Merging a PR **is** a deploy. Say so before asking for a merge.
- `.github/workflows/verify.yml` runs on every PR and on master: guards, backend typecheck + tests, frontend typecheck + lint + build. **A PR must be green before you ask for a merge.**

## 3. Test before pushing

"Typecheck passes" is not "tested." Minimum bar:

```bash
node scripts/guards.mjs                       # must be 0 blocking
cd backend  && npx tsc --noEmit && npm test   # needs TEST_DATABASE_URL
cd frontend && npx tsc --noEmit && npx eslint . && npm run build
```

- **`scripts/guards.mjs`** greps for bug classes this repo has actually shipped (dynamic Tailwind class names, mount-only search-param reads, UTC date-only strings, inner joins over the purchase catalogues, unescaped LIKE, interpolated SQL). Every rule states why it exists. Blocking hits must be fixed, not excluded; to allow one line, append a `guards-allow` comment **with a reason**.
- If you change a payload shape, grep for *every* route that accepts it. A create schema was once updated while the matching PATCH was not, and editing became impossible for the new shape.
- If a UI change can't be verified because the browser isn't signed in, say so and ask the user to check — don't call it done.

## 4. The databases

Both live on the same Postgres (18.4, on the VPS at `147.93.19.105`). There is no local Postgres and no Docker on either machine.

| Database | What it is |
|---|---|
| `inventory` | **production** — what https://inventory.acronix.in serves. Never point local work at it. |
| `inventory_dev` | everything else: local development **and** the test suite. `backend/.env`'s `DATABASE_URL` points here. |

There is deliberately no separate test database any more. Keeping one in step across two machines cost more than it saved, and a second connection string in every `.env` was a setup step people got wrong. CI still uses its own throwaway Postgres, via `TEST_DATABASE_URL` — which stays supported, just optional.

- **Never run destructive SQL against `inventory`.** For any write while investigating, use `BEGIN … ROLLBACK` and verify the rollback.
- `inventory_dev` has one login seeded — **Dev Owner / 9999999999**. It needs one: the app only adds users when an owner is already signed in. `npm run seed` is what creates that first owner, from the `SEED_OWNER_*` keys in `.env`; it is idempotent and refuses a password under 8 characters.
- **`npm test` TRUNCATES tables in `inventory_dev`.** The tests run against `DATABASE_URL` unless `TEST_DATABASE_URL` is set, so anything sitting in the dev database is gone the moment the suite runs. That is deliberate — dev data is disposable, and keeping a second database in step was more setup than it was worth. Seed what you need in a fixture, not by hand.
- The one rule the harness still enforces is that it **refuses to open `inventory`**, by name. Dev and production share a Postgres host, so the database name is the only thing that can tell them apart. See `backend/tests/helpers/db.ts`.
- Anything in the `users` table outside mobiles `9000000000`–`9000000099` survives a test run — that block is reserved for fixtures, so the suite cannot delete the login you sign in with.
- **Don't try to run the suite against the VPS as a habit** — every query is a ~2s round trip and sockets drop mid-run, so it fails on infrastructure rather than logic. CI runs a `postgres:18-alpine` service on the runner; that is where the suite is meant to run.
- Migrations are forward-only files in `backend/src/db/migrations/`, applied with `npm run migrate`. The deploy pipeline does **not** run them, so a migration reaches production only when someone applies it by hand. Say explicitly which database you have applied one to.

## 5. Ports — check before starting anything

| Process | Command (cwd) | Port |
|---|---|---|
| Frontend (Next.js) | `npm run dev` in `frontend/` | **3000** |
| API (Express) | `npm run dev` in `backend/` | **4000** |

Both are usually already running. Check first, reuse if healthy, and don't blanket-kill node:

```bash
lsof -iTCP -sTCP:LISTEN -P -n | grep -E ':(3000|4000)\b'
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health
```

## 6. Reuse what's already built

Read the module you're touching before adding to it, and match its patterns.

- `backend/src/modules/<area>/` — `*.repo.ts` owns SQL, `*.routes.ts` owns validation. Never put SQL in a route.
- `backend/src/utils/validation.ts` — `parseId`, date schemas. Use these, don't re-derive.
- `backend/src/config/db.ts` — `query()` and `withTransaction()`. Always parameterised (`$1`), never string-built.
- `frontend/components/ui/` — `Modal` (animated close; `footer` may be a render fn receiving `close()`), `ConfirmDialog` (**use this, never `confirm()`**), `Combobox` (portaled, so tables can't clip it), `DateField`, `DateRangePicker`.
- `frontend/components/` — `page-parts.tsx` (`PageHeader` portals title/actions into the top bar), `material-rows.tsx` (`PricedRows` / `MaterialRows`), the form and modal components per entity.
- `frontend/lib/` — `api.ts`, `cache.ts` (`cachedGet`/`bustCache`), `use-server-list.ts`, `utils.ts` (`rupees`, `qty`, `formatDate`, `todayISO`).

Tailwind class names must be **literal strings** — a class assembled from a template literal is never emitted.

## 7. Sale and Customers are OUT OF SCOPE

The app is inventory-only. These are hidden from the menu and **no work is to be done on them**:

```
backend/src/modules/sales/**          frontend/app/(app)/sales/**
backend/src/modules/customers/**      frontend/app/(app)/customers/**
                                      frontend/app/(app)/reports/sales/**
                                      frontend/components/customer-receive-modal.tsx
```

Every one of those files carries an `UNUSED — SALE / CUSTOMER MODULE` banner. They are kept rather than deleted so billing can be switched back on later without rebuilding it — routes, tables and data are all intact.

Don't extend, refactor or "tidy" them, and don't count them when asked to clean up dead code. If a change there looks necessary, ask first — it usually means something outside the module is wrong. To bring the module back, re-add its two `NAV` entries in `components/app-shell.tsx` and drop the banners.

## 8. UI conventions the owner has settled

- Money lives on the **vendor** side only. A karigar has "total paid", no dues.
- Transactions live inside their master's hub: purchases in `/vendors/account`, jobs in `/karigars/account`. Don't add a top-level page for them.
- Menu is inventory-only right now — Customers and Sale are hidden but their code is intact.
- UI strings in **English**; reply to the owner in **Hinglish**.
- Every list needs search + filter + sort. Tables are full-width, row-click opens the detail hub, and horizontal rules use `--border-strong`.

## Reference

- Mobile app (Flutter, Android first): [MOBILE.md](MOBILE.md) — decisions, the API work it needs first, and how to set up on the Windows machine. Nothing is built yet.
- Deployment: [DEPLOY.md](DEPLOY.md)
- Frontend framework caveats: [frontend/AGENTS.md](frontend/AGENTS.md) — this Next.js differs from training data; read `node_modules/next/dist/docs/` first.
