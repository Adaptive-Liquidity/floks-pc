# Live /setup — operator checklist

This Next app can run as a look-only preview with env stubs. Real login → desk needs secrets that this PR does not set.

Vercel project Root Directory is `web`. `web/package.json` therefore lists `zod` and `@runloop/api-client` (same versions as the repo root) so `../src/lib/computers` compiles when only the web install exists.

Preview target is `floks-pc.vercel.app`. Do not change Cloudflare DNS or cut over floks-pc.com from this PR.

## What the code does

1. `/signup` redirects to WorkOS AuthKit Magic Auth with `screen_hint=sign-up`. `/login` uses `screen_hint=sign-in`. `/login?screen=sign-up` is the same hint as `/signup`.
2. `/callback` GET with a `code` returns an auto-POST (does not exchange on GET/prefetch). POST exchanges the one-use code for a sealed `wos-session` cookie. Failures are logged as `[authkit]` (no code/password). Missing `WORKOS_COOKIE_PASSWORD` is `/setup` (not “this sign-in is not valid”). Return is `/setup` (plus `session_id` when checkout state is present). It never mints a cookie from `session_id`.
3. `/setup` is the signed-in account home. No cookie → Create account / Sign in (not an invalid-invitation door). Cookie + $0 seats → email, one-line FLOKS, empty desks, plan CTAs. Cookie + seat → pair / approve / desk.
4. Pair keys call `issuePairCode` / `revokeUnusedPairCodes` on the real computer domain. FakeProvider is default. Runloop is opt-in.
5. Stripe webhook `POST /api/webhooks/stripe` creates or updates seats. Signed-in users with no seat stay on `/setup` and buy from that account. Manage billing (`POST /api/setup/portal`) requires a session; no Stripe customer returns to `/setup`.

## Caelin — before a Vercel preview is usable

On Vercel project `floks-pc` (do not deploy to production from this PR):

- Add the env names from `web/.env.example` (values stay in the dashboard).
- WorkOS **staging** redirect URIs must include the Vercel preview URL:
  - `https://floks-pc.vercel.app/callback`
  - Initiate login: `https://floks-pc.vercel.app/login`
  - Initiate sign-up: `https://floks-pc.vercel.app/signup`
  - Homepage / logout return: `https://floks-pc.vercel.app/setup`
- Recommended WorkOS AuthKit `signUpUrl` (dashboard-side, Caelin/NOEMA — this PR does not change WorkOS): `https://floks-pc.vercel.app/signup`
- Stripe webhook endpoint: `https://floks-pc.vercel.app/api/webhooks/stripe` (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`).
- Recommended Stripe Payment Link success URL (dashboard-side — this PR does not change Stripe): `https://floks-pc.vercel.app/setup?session_id={CHECKOUT_SESSION_ID}`
- Apply `migrations/0003_web_seats.sql` if `DATABASE_URL` is set. Without it, seats live in memory or `.flok/seats.json` (not durable on Vercel).
- Do **not** change Cloudflare DNS or floks-pc.com in this pass.

## Smoke on floks-pc.vercel.app after deploy

- Unsigned `/`: header and hero primary CTAs are **Create account** + **Sign in**. Plans / Buy is secondary and still nudges account first.
- `/signup` lands on AuthKit with the sign-up screen. `/login` is sign-in. `/login?screen=sign-up` is sign-up.
- **Auth handoff (Caelin retest):** Create account or Sign in as `cael.b@asentxia.com` → after the 6-digit code, land on **signed-in** `/setup` (empty seats OK). Header shows **Account**, not Create account. Must not show “This sign-in is not valid.”
- Confirm Vercel Preview env has `WORKOS_COOKIE_PASSWORD` (32+ chars, same as the WorkOS seal), `WORKOS_API_KEY` + `WORKOS_CLIENT_ID` for Production, and `WORKOS_REDIRECT_URI=https://floks-pc.vercel.app/callback`. Production `floks-pc.com/callback` is wrong until DNS cutover.
- If it still fails, Vercel function logs for `/callback` should show `[authkit] callback.authenticate` with `error` / `cookiePasswordConfigured` / `cookiePasswordLength` (never the password or code).
- Unsigned `/setup` shows Create account + Sign in, not “invalid invitation” / “this sign-in is not valid”.
- Signed in, $0 seats: `/setup` shows the email, a one-line FLOKS line, empty-desk copy, and Spark/Desk/Shift CTAs (Payment Links with `prefilled_email`).
- Signed in, with a seat: existing pair / approve / desk / connector.
- `/join` while unsigned: account-first copy; plan buttons go to `/signup`. `/join` while signed in: Payment Links.
- Manage billing only appears while signed in (header) and posts to `/api/setup/portal`.

## Live Runloop (spend money — not for CI)

Default provider is FakeProvider. To provision a real Agent Computer:

```
RUNLOOP_API_KEY=<secret>
FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive
FLOK_WEB_PROVIDER=runloop
FLOK_CONTROL_PLANE_PATH=.flok/control-plane.json
```

Creating a pair key on an unused seat calls `ComputerService.requestComputer`, which provisions. Do not set this in CI. Do not spam paid Devboxes.

## Preview fixtures

`/setup?preview=running` works only when `FLOK_WEB_PREVIEW=1` and `NODE_ENV` is not `production`. Public UI does not advertise hatch/desk galleries.
