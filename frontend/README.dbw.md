# Diamond Box Wala — Frontend

Next.js 16 (App Router) + React 19 + Tailwind v4. Theme: **Royal Indigo & Gold** (light/dark).
Lightweight custom UI components (shadcn-style) — no heavy component library.

## Setup

```bash
cd frontend
# .env.local already points to the backend:
#   NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm install        # already done by scaffolder
npm run dev        # http://localhost:3000
```

Backend pehle chalu hona chahiye (`../backend` → `npm run dev`), warna login/data load nahi hoga.

## Login

Backend seed se bana owner use karein (default `.env`): mobile `9999999999`, password `owner123`.

## Structure

```
app/
  layout.tsx            root: theme init + Auth/Toast providers
  login/page.tsx        login screen
  (app)/                protected route group (auth guard + sidebar shell)
    layout.tsx          redirects to /login if not logged in
    page.tsx            Dashboard
    vendors/page.tsx    Vendors — list, search, add/edit, ledger  (full)
    karigars, items, products, purchases   (placeholders — next step)
lib/
  api.ts                fetch wrapper (token, errors, 401 -> /login)
  auth.tsx              auth context (login/logout, /auth/me)
  utils.ts              cn, rupees, date/qty formatting
components/
  app-shell.tsx         sidebar + topbar
  ui/                   button, field, modal, misc (card/badge/spinner), toast, tag-input
  icons.tsx, theme-toggle.tsx
```

## Status — Phase 1 frontend complete ✅

- ✅ Auth (login/logout, protected routes, roles)
- ✅ App shell + theme toggle (Royal Indigo & Gold, light/dark)
- ✅ Dashboard (summary)
- ✅ Vendors (search + add/edit + ledger, owner-only delete)
- ✅ Karigars (search + add/edit + product-type tags, balance)
- ✅ Raw Materials (units + colors, dynamic category autocomplete)
- ✅ Products (size/design variants, dynamic category)
- ✅ Purchases (vendor + dynamic item rows + advance → stock & payable)

`npm run build` green. Live data ke liye backend + Postgres (DATABASE_URL) chahiye.
