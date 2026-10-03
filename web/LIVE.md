# Live /setup — operator checklist

The public product name is **Staxions**. Full env + webhook checklist: `docs/DEPLOY.md`.

This Next app can run as a look-only preview with env stubs. Real login → desk needs secrets that this PR does not set.

Vercel project Root Directory is `web`. `web/vercel.json` runs `npm ci` here and at the repo root so `../src/lib/computers` typechecks (`zod`).

Do not change Cloudflare DNS or cut over floks-pc.com from this PR. Set `APP_URL` to the Preview origin instead.

## What the code does

1. `/signup` redirects to WorkOS AuthKit Magic Auth with `screen_hint=sign-up`. `/login` uses `screen_hint=sign-in`.
2. `/callback` GET with a `code` returns an auto-POST. POST exchanges the code for a sealed `wos-session`. `invalid_client` (WorkOS key/environment mismatch) is a visible HTML error, not a silent `/setup` bounce.
3. `/setup` is the signed-in account home. Active seats auto-provision computers (webhook also tries). Pair / approve still binds the Bot.
4. `/pricing` (and `/join`) start Stripe Checkout Sessions. Enterprise is contact-only.
5. `POST /api/webhooks/stripe` maps Price ids from env, claims the event id, then provisions only after a paid event. Payment failure and cancel start a grace period, then suspend (files stay). `GET /api/cron/computers` meters hours and idle-suspends on Production. Preview does not run cron.

## Caelin — before a Vercel preview is usable

On Vercel project `floks-pc` (do not deploy to production from this PR):

- Add the env names from `web/.env.example` / `docs/DEPLOY.md`.
- `WORKOS_CLIENT_ID` + `WORKOS_API_KEY` must be the same WorkOS environment.
- Redirect URI must include this Preview `/callback` (not floks-pc.com until DNS cutover).
- Stripe **test** Price ids in `STRIPE_PRICE_PERSONAL` / `_PRO` / `_TEAM`.
- Stripe test webhook: `https://<preview>/api/webhooks/stripe`.
- `DATABASE_URL` + apply `migrations/0003_web_seats.sql` through `0009_pending_binds.sql`. `0010_billing_grace.sql` is a file in this PR — do not apply it to a live database from the PR.
- `APP_URL=https://<preview-host>` (never floks-pc.com).
- `STRIPE_PORTAL_CONFIGURATION_ID` from the Stripe Customer Portal configuration (dashboard, not created in-process).

## Live Runloop (spend money — not for CI)

```
FLOK_WEB_PROVIDER=runloop
RUNLOOP_API_KEY=<secret>
FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive
DATABASE_URL=<postgres>
```

`/setup` after a successful test checkout calls `ComputerService.requestComputer`. Do not set this in CI.

## Preview fixtures

`/setup?preview=running` works only when `FLOK_WEB_PREVIEW=1` and `NODE_ENV` is not `production`.
