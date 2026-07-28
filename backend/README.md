# Diamond Box Wala — Backend API

Express + PostgreSQL (raw SQL via `pg`). Phase 1: Masters, Purchase + raw stock, Vendor ledger.

## 1. Database chahiye (ek baar)

Sabse aasaan — **Neon** (free cloud Postgres, 2 min):
1. https://neon.tech pe sign up karein → "Create project".
2. Connection string copy karein (aisa dikhega: `postgres://user:pass@ep-xxx.aws.neon.tech/dbname?sslmode=require`).

Ya local Mac ke liye **Postgres.app** (https://postgresapp.com) — install → start → string banega
`postgres://<macuser>@localhost:5432/diamond_box`.

## 2. Setup

```bash
cd backend
cp .env.example .env         # phir .env mein DATABASE_URL aur JWT_SECRET bharein
npm install
npm run migrate              # saari tables banayega
npm run seed                 # owner login banayega (.env se mobile/password)
npm run dev                  # http://localhost:4000
```

Health check: `curl http://localhost:4000/api/health`

## 3. Login test

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"mobile":"9999999999","password":"owner123"}'
```
Response mein `token` milega — baaki API calls mein header `Authorization: Bearer <token>`.

## API (Phase 1)

| Method | Path | Kaam |
|---|---|---|
| POST | `/api/auth/login` | Login (mobile + password) |
| GET | `/api/auth/me` | Current user |
| POST/GET | `/api/auth/users` | Staff banao / list (owner only) |
| GET/POST/PUT/DELETE | `/api/vendors` | Vendors + `?search= &sort= &dir= &page=` |
| GET | `/api/vendors/:id/ledger` | Vendor ledger |
| GET/POST/PUT/DELETE | `/api/karigars` | Karigars (`?productType=` filter) |
| GET/POST/PUT/DELETE | `/api/items` | Raw materials (units + colors) |
| GET | `/api/items/meta/categories`, `/meta/units` | Autocomplete lists |
| GET/POST/PUT/DELETE | `/api/products` | Finished products (variants) |
| GET/POST | `/api/purchases` | Purchase (stock inward + vendor payable) |
| GET/POST | `/api/payments` | Vendor/karigar/customer payments |
| GET | `/api/reports/raw-stock` | Raw material on hand |
| GET | `/api/reports/raw-by-vendor` | Kaunsa material kis vendor se |
| GET | `/api/reports/dashboard` | Home summary |

Delete = soft delete (record `is_active=false`), owner-only. Har list mein search/filter/sort.

## Structure

```
src/
  config/      env, db pool + transaction helper
  db/          migrations/*.sql, migrate runner, seed
  middleware/  auth (JWT + roles), error handler
  modules/     auth, vendors, karigars, items, products, purchases, payments, reports
               (har module: *.repo.ts = SQL, *.routes.ts = HTTP + validation)
```
