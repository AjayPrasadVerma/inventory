# Mobile app — handoff

Written 2026-09-02 on the Mac, to be picked up on the Windows machine. **Nothing is built yet.** This file is the decisions, the groundwork and the traps, so whoever starts does not have to re-decide any of it or rediscover it the hard way.

Read [CLAUDE.md](CLAUDE.md) first — the branching, database and testing rules there apply to this work too.

---

## What is being built

An **Android** app first, **iOS** after, both from one codebase, consuming the existing REST API at `https://inventory.acronix.in/api`. The API needs no rewrite; it is already JWT + JSON.

## Decisions, and why

| Decision | Why |
|---|---|
| **Flutter / Dart** | Owner's choice, made knowing the alternative. Data-dense lists render consistently on cheap Android phones, and one codebase covers both platforms. The cost — see the risk below — was accepted deliberately. |
| **Android first** | The shop runs on Android. iOS is wanted but not urgent. |
| **Scope: the "standing up in the shop" flows** | Dashboard, karigar IN / OUT / Pay, and stock lookup. These are the things done while walking around, which is what a phone is for. |
| **No offline mode** | Internet at the shop is reliable, only slow. Offline sync would cost far more than it returns here. |
| **Optimise for slow, not absent, internet** | Fewer round trips, cache-first render (show what you have, refresh behind it), pagination, debounced search. |

**Not in scope:** the purchase and catalogue entry sheets. They are spreadsheets — a desktop idiom — and squeezing them onto a phone would produce something worse than the website, which is already mobile-responsive.

## The one real risk

**Nothing connects the API contract to the Dart models.**

On the web, changing a payload shape in Express makes `tsc` fail in the frontend immediately. Dart cannot see Express at all, so the same change compiles fine and breaks at runtime, on a phone, in the shop.

Mitigations, in order of how much they help:

1. Keep every model in one directory, one file per endpoint group. Never parse JSON inline in a widget.
2. When you change a payload in `backend/src/modules/**`, grep the Dart models in the same commit. Treat it like the existing rule in CLAUDE.md §3 about create-vs-PATCH schemas drifting apart — that has already bitten this repo once.
3. Write a contract test that hits a running API and decodes into the models. It catches drift at CI time rather than in the shop.

---

## Before any Flutter is written: the API needs refresh tokens

This is the one genuine API prerequisite, and it is not optional.

`JWT_EXPIRES_IN` is **7 days** with no refresh token (`backend/src/config/env.ts`, `backend/src/middleware/auth.ts`). On the web that is invisible — the browser is open, the session is short-lived by nature. On a phone it means **being thrown back to the login screen every week**, which nobody accepts from an app.

What is needed:

- Login returns an **access token** (short, e.g. 15 min) and a **refresh token** (long, e.g. 90 days).
- A `POST /api/auth/refresh` that trades a refresh token for a new pair and **rotates** the refresh token.
- Refresh tokens stored server-side so removing a user kills their refresh token too — otherwise the removal work described below is undone by the refresh path.
- On the client: `flutter_secure_storage` for both tokens, never `SharedPreferences`.

**Do not weaken what is already there.** `requireAuth` re-reads the account on every request (30s cache, `forgetUser()` clears it on write), so removing a user or changing their role takes effect on their next request rather than in seven days. That was deliberate — see the user module commit — and it works for mobile unchanged. Any refresh endpoint must run the same check.

## What NOT to spend time on

**Do not add gzip/compression to Express.** The instinct is right and the work is already done: **Cloudflare sits in front of the API and serves Brotli** (`content-encoding: br` on a live response). Compressing again at the origin would buy nothing the client can see.

On a slow link the win is in **round trips, not payload size**. Count the requests a screen makes before optimising anything else — if the dashboard makes five calls, one endpoint that returns all five answers beats any amount of shrinking.

---

## Setting up on Windows

### The repo

Everything is on GitHub and pushed. Clone it, then follow CLAUDE.md §1: **work on `claude/features`, never make a new branch.**

### `backend/.env` — not in git, must be recreated

Copy `backend/.env.example` to `backend/.env` and fill it in. The keys that matter:

| Key | What to put |
|---|---|
| `DATABASE_URL` | Point at **`inventory_dev`** on the VPS — never `inventory`, which is production. This is the only database you need; the tests use it too. See CLAUDE.md §4. |
| `TEST_DATABASE_URL` | **Leave it empty.** It only exists so CI can point the suite at its own throwaway Postgres. Setting it here just means another database to keep in step. |
| `JWT_SECRET` | Any long random string for local work. |
| `CORS_ORIGIN` | `http://localhost:3000` for the web frontend. A native Flutter app sends no `Origin` header, so it needs no entry here — but a WebView-based build would. |
| `SEED_OWNER_*` | Used by `npm run seed`, below. |

The databases live on the VPS Postgres, so they are reachable from Windows exactly as they are from the Mac. No local Postgres is needed.

### Getting a login

`inventory_dev` needs at least one user or nobody can sign in — and the app can only add users when an owner is already signed in. Break that circle with:

```bash
npm run seed --prefix backend
```

It reads `SEED_OWNER_NAME` / `SEED_OWNER_MOBILE` / `SEED_OWNER_PASSWORD` from `.env`, refuses a password under 8 characters, never logs the password, and does nothing if that mobile already exists. A **Dev Owner / 9999999999** already exists in `inventory_dev` — change its password from the app's Users screen rather than committing one anywhere.

### Running things

Ports and commands are in CLAUDE.md §5 — frontend on 3000, API on 4000. Check before starting; do not blanket-kill node.

### Flutter toolchain

None of it is installed on the Mac, and it will not be on Windows either. Needed: Flutter SDK, Android Studio, the Android SDK and a JDK — roughly 12–15 GB. Android Studio's first run (SDK download and accepting licences) has to be done through its GUI.

Point the app at `http://10.0.2.2:4000/api` from the Android emulator — `localhost` inside the emulator is the emulator itself, not the machine.

---

## iOS, later

**iOS builds require macOS.** Xcode does not run on Windows, and there is no way around that.

This is not a problem, it is just sequencing: the Flutter code is the same for both. Build Android on Windows, and when iOS comes up, pull the same repo on the Mac and build there. Nothing gets rewritten.

## Suggested order

1. Refresh tokens on the API (no Flutter needed — can be done from either machine).
2. Flutter project skeleton: HTTP client with an auth interceptor that refreshes on 401, secure token storage, login screen. Riverpod for state unless there is a reason to prefer otherwise.
3. Dashboard, then karigar IN/OUT/Pay, then stock lookup.

Each of those is a normal PR onto `claude/features` — and remember that merging to `master` deploys the website. A mobile-only change still goes through the same pipeline, so keep the PR green.
