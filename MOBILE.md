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

## Refresh tokens — **built**, and this is the contract

This was the one genuine API prerequisite. It is done; the endpoints below are what the Dart models decode.

`POST /api/auth/login` — body `{ mobile, password }`:

```json
{ "token": "<jwt>", "accessToken": "<jwt>", "refreshToken": "<opaque>",
  "user": { "id": 1, "name": "…", "role": "owner" } }
```

`token` and `accessToken` are the **same value**. `token` is the old name and only still exists because the web frontend reads exactly that field; merging deploys the site, so renaming it would have signed everyone out at the moment of the deploy. **Mobile should read `accessToken`** — the alias goes once the web moves.

`POST /api/auth/refresh` — body `{ refreshToken }`, returns the same shape with a **new refresh token**. The old one is spent by the call.

`POST /api/auth/logout` — body `{ refreshToken }`, returns `{ "ok": true }`. Ends that one session. Neither refresh nor logout needs an access token: both have to work once it has expired, which is the only time either is reached.

Every failure on either path is **401 with the same sentence**, deliberately — which of the reasons it was is not something the response should reveal, and the app does the same thing in all of them: sign in again.

### What the client must get right

- **Rotation is not optional.** A refresh token is spent by using it. Store the new one before the old is discarded, and never send the same one twice — a replayed token is treated as stolen and **ends every session that user has**, on every device.
- **Serialise refreshes.** Two requests hitting 401 together must not both refresh: one wins, the other looks like a replay and signs the user out. One in-flight refresh, with the rest waiting on it.
- `flutter_secure_storage` for both tokens, never `SharedPreferences`.

### The access-token lifetime is deliberately still 7 days

`ACCESS_TOKEN_TTL` (new name) and `JWT_EXPIRES_IN` (old, still read) both set it, and the default stays **7d**.

It *should* be 15m — that is the point of having refresh tokens — but **the web frontend cannot refresh yet**: `frontend/lib/api.ts` treats any 401 as the end of the session, clears the token and goes to `/login`. Shortening this before that is fixed would sign the shop out every fifteen minutes, and merging to `master` is a deploy. So: teach the web to refresh, then drop the default. Until then a phone can be given a short lifetime on its own by setting `ACCESS_TOKEN_TTL`, because it *does* refresh.

`REFRESH_TOKEN_TTL_DAYS` defaults to 90. Rotation re-dates it on every use, so it caps how long you can be **away** from the app, not how long you stay signed in.

### What was not weakened

`requireAuth` is untouched. It still re-reads the account on every request (30s cache, `forgetUser()` clears it on write), so removing a user or changing their role bites on their next request rather than in seven days.

The refresh route makes **the same live check** — it re-reads the account and refuses a removed user — and removal now revokes their stored refresh tokens outright. Without both halves, removing someone would stop their next request and then hand them a fresh token a minute later. A password change ends their sessions too.

A demotion deliberately does *not* end the session: both `requireAuth` and the refresh route take the role from the live row, so the smaller role is already in force.

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

1. ~~Refresh tokens on the API~~ — **done**, contract above.
2. Teach the web frontend to refresh, then shorten `ACCESS_TOKEN_TTL` to 15m. No Flutter needed, and until it happens the access token stays a 7-day one on every client.
3. Flutter project skeleton: HTTP client with an auth interceptor that refreshes on 401, secure token storage, login screen. Riverpod for state unless there is a reason to prefer otherwise.
4. Dashboard, then karigar IN/OUT/Pay, then stock lookup.

Each of those is a normal PR onto `claude/features` — and remember that merging to `master` deploys the website. A mobile-only change still goes through the same pipeline, so keep the PR green.
