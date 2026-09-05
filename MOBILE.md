# Mobile app — handoff

Written 2026-09-02 on the Mac, picked up on the Windows machine. The **API work is done and the Flutter skeleton exists** — see the contract and the app structure below. This file is the decisions, the groundwork and the traps, so nobody has to re-decide any of it or rediscover it the hard way.

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
3. Write a contract test that hits a running API and decodes into the models. It catches drift at CI time rather than in the shop. `backend/tests/activity-feed.test.ts` pins the day-feed payload from the server side, which is half of it.

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

### The access-token lifetime is 15 minutes

`ACCESS_TOKEN_TTL` (new name) and `JWT_EXPIRES_IN` (old, still read after it) both set it. The default is **15m**, which is short on purpose: an access token is the one credential here that cannot be revoked, only outlived.

The web frontend refreshes now — `frontend/lib/api.ts` renews on a 401 and repeats the request — so nothing is left waiting on that. **A `.env` still carrying `JWT_EXPIRES_IN=7d` keeps seven-day access tokens**, since the old name is still honoured; remove that line to pick the short default up.

`REFRESH_TOKEN_TTL_DAYS` defaults to 90. Rotation re-dates it on every use, so it caps how long you can be **away** from the app, not how long you stay signed in.

### The web client is the reference implementation

`frontend/lib/api.ts` is worth reading before writing the Dart interceptor — it solves the same problems, and the serialisation one is easy to get wrong. It keeps a single in-flight refresh promise that every waiting request awaits, so a screen firing four calls at once refreshes once rather than four times. Four parallel refreshes would spend the same token four times, and the API reads a spent token as theft: it would sign the shop out of every device.

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

Everything lives on **D:**, deliberately — C: was down to 10 GB and Gradle alone reaches several.

| | |
|---|---|
| Flutter 3.47.2 / Dart 3.13.2 | `D:\flutter` |
| Android Studio 2026.1 (Quail 4) | `D:\Android\Android Studio` |
| Android SDK | `D:\Android\sdk` — `ANDROID_HOME`, `ANDROID_SDK_ROOT` |
| Emulator AVDs | `D:\Android\avd` — `ANDROID_AVD_HOME` |
| Gradle caches | `D:\dev\gradle` — `GRADLE_USER_HOME` |
| Pub cache | `D:\dev\pub-cache` — `PUB_CACHE` |

Installed SDK packages: platform `android-37.0`, build-tools 36.0.0 and 37.0.0, platform-tools 37.0.1, NDK 28.2.13676358 and 30.0.16138531, CMake 3.22.1.

### Three Android traps, all hit and all solved

**1. `compileSdk` must be 37, and this is not optional.** `flutter_secure_storage` 11 declares in its AAR metadata that dependants compile against API 37 or later; with Flutter's default of 36 the build dies at `:app:checkDebugAarMetadata`. `android/app/build.gradle.kts` pins `compileSdk = 37` with the reason written next to it. AGP 9.1.0 calls 36 its "maximum recommended" — a recommendation, not a limit; it builds. `minSdk` and `targetSdk` are untouched, so which phones can install the app has not changed.

**2. Gradle cannot install SDK packages any more.** AGP provisions a missing NDK by shelling out to cmdline-tools' `sdkmanager`, which Google has replaced with a shim over the new `android` CLI — and the shim **crashes** (`NTSTATUS 0xC0000409`) instead of installing. Anything the build needs must be installed by hand from Android Studio's SDK Manager first. Removing `ndkVersion` from the app's gradle file does *not* dodge this: the Flutter Gradle Plugin hardcodes it (`FlutterExtension.kt`).

**3. `flutter doctor` reports "Android license status unknown", and it is wrong.** The new `android` CLI has no licences command, so `flutter doctor --android-licenses` answers "no longer needed" and Flutter cannot read the status. Licences are fine — builds complete. Ignore that line.

### Running it on a real phone (better than the emulator)

No system image to download, and real performance. This is how the app was first verified:

```bash
adb devices                        # phone must show as "device"
adb reverse tcp:4000 tcp:4000      # phone's localhost:4000 -> this machine's
npm run dev --prefix backend       # API on 4000
cd mobile && flutter run --dart-define=API_BASE_URL=http://localhost:4000/api
```

`adb reverse` tunnels over USB, so no WiFi, no LAN IP and no `10.0.2.2`. On the phone: Developer options on (tap Build number 7 times), USB debugging on, and accept the RSA prompt.

For the **emulator** instead, the API is `http://10.0.2.2:4000/api` — `localhost` inside the emulator is the emulator. That is the default in `lib/src/config/app_config.dart`.

Android blocks plain http, so the debug manifest carries `usesCleartextTraffic` — debug only, since production is https.

**Judge performance on a release build, never a debug one.** Debug Flutter is JIT with every assertion on; it is meant to be slow.

---

## The app, as built

Lives in `mobile/`, package `acronix_inventory`. Riverpod for state, per the decision above.

```
mobile/lib/
  main.dart                       ProviderScope + AcronixApp, nothing else
  src/
    app.dart                      one decision: who is signed in decides the screen
    config/app_config.dart        API base URL (--dart-define=API_BASE_URL to override)
    api/
      api_client.dart             every request goes through here — see below
      token_store.dart            TokenStore interface + the flutter_secure_storage one
      api_exception.dart          what the server refused, in the server's words
    models/                       ALL JSON decoding lives here and nowhere else
      auth.dart                   AuthUser, Session, Role
      json.dart                   field readers that name what drifted
    features/
      auth/                       auth_controller.dart (AsyncNotifier), login_screen.dart
      home/                       placeholder; the real screens are step 4
```

### Why a hand-rolled client and not dio

`frontend/lib/api.ts` already solves this exact problem, and keeping the two shaped alike means a fix to one is obviously portable to the other. It also stays testable with a plain `http.Client` stub, which is what makes the single-flight rule provable instead of hoped for — `mobile/test/api_client_test.dart` holds four requests at their 401s simultaneously and asserts **one** refresh call.

### The rule that is easy to break

Nothing outside `lib/src/models/` may call `jsonDecode` on an API reply. That is mitigation 1 from "the one real risk" above, and it is the only reason a renamed backend field produces `Session: expected a value at "refreshToken"` instead of a null-check crash three widgets deep.

`models/json.dart` exists for that message. When you change a payload in `backend/src/modules/**`, grep `mobile/lib/src/models/` in the same commit.

### What is NOT done

- **Recording anything.** IN, OUT and PAY sit on the dashboard and say so when tapped; the forms behind them are the next screens, along with stock lookup.
- **No contract test against a running API** — mitigation 3 above. The model tests pin today's payload shape by hand, which catches a rename only if someone updates the fixture; a test that logs into a real API would catch it on its own.
- No router. One screen decides the other; adding a router before there is somewhere to route would be guessing.
- **Nothing is cached on disk.** A cold start shows skeletons until the API answers. Riverpod holds the data while the app is alive, which is not the same as the cache-first rule surviving a restart.
- **iOS untouched** — the platform folder exists, nothing more.

### What HAS been verified on a real phone

Signed in on a Vivo V2318 over USB against the local API: login succeeded, the `Session` decoded, both tokens went into `flutter_secure_storage`, the app routed to the home screen, and a `refresh_tokens` row appeared server-side for that session. So the plumbing this step exists to build is real, not just analysed.

---


## iOS, later

**iOS builds require macOS.** Xcode does not run on Windows, and there is no way around that.

This is not a problem, it is just sequencing: the Flutter code is the same for both. Build Android on Windows, and when iOS comes up, pull the same repo on the Mac and build there. Nothing gets rewritten.

---

## Suggested order

1. ~~Refresh tokens on the API~~ — **done**, contract above.
2. ~~Teach the web frontend to refresh, then shorten the access token to 15m~~ — **done**. One server-side step remains: drop `JWT_EXPIRES_IN` from `/opt/inventory/.env.api` so production stops overriding the new default.
3. ~~Flutter project skeleton~~ — **done**, structure above, and verified by signing in on a real phone. The three Android traps it uncovered are written up under "Flutter toolchain".
4. ~~Dashboard~~ — **done**: the day feed with a date picker, an entry detail page, and what needs restocking. Next: the karigar IN / OUT / Pay forms, then stock lookup.

Each of those is a normal PR onto `claude/features` — and remember that merging to `master` deploys the website. A mobile-only change still goes through the same pipeline, so keep the PR green.
