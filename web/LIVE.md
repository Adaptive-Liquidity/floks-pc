# Live /setup — operator checklist

This Next app can run as a look-only preview with env stubs. Real login → desk needs secrets that this PR does not set.

Vercel project Root Directory is `web`. `web/package.json` therefore lists `zod` and `@runloop/api-client` (same versions as the repo root) so `../src/lib/computers` compiles when only the web install exists.

## What the code does

1. `/login` redirects to WorkOS AuthKit Magic Auth (6-digit email code).
2. `/callback` exchanges `code` for a sealed `wos-session` cookie. It never mints a cookie from `session_id`.
3. `/setup` reads that cookie, binds seats by WorkOS email ↔ Stripe customer email (case-insensitive), and lists desks from `ComputerService`.
4. Pair keys call `issuePairCode` / `revokeUnusedPairCodes` on the real computer domain. FakeProvider is default. Runloop is opt-in.
5. Stripe webhook `POST /api/webhooks/stripe` creates or updates seats. Signed-in users with no seat are sent to `/join`.

## Caelin — before a Vercel preview is usable

On Vercel project `floks-pc` (do not deploy to production from this PR):

- Add the env names from `web/.env.example` (values stay in the dashboard).
- WorkOS **staging** redirect URIs must include the Vercel preview URL:
  - `https://<preview>.vercel.app/callback`
  - Initiate login: `https://<preview>.vercel.app/login`
  - Homepage / logout return: `https://<preview>.vercel.app/setup`
- Stripe webhook endpoint: `https://<preview>.vercel.app/api/webhooks/stripe` (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`).
- Apply `migrations/0003_web_seats.sql` if `DATABASE_URL` is set. Without it, seats live in memory or `.flok/seats.json` (not durable on Vercel).
- Do **not** change Cloudflare DNS or floks-pc.com in this pass.

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
