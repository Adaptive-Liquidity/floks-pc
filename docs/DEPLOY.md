# Staxions deploy checklist

Product name is **Staxions** (no T before the X). This package is the public site (`web/`) plus the Agent Computer runtime.

Do **not** promote a Preview to Vercel Production, change DNS, or edit live Stripe / WorkOS settings from a code PR. Set env vars in the Vercel dashboard. Never commit secrets.

## Vercel project

- Root Directory: `web`
- `web/vercel.json` installs `web` **and** the repo root so `../src` can resolve `zod`.
- Cron: `GET /api/cron/computers` every 5 minutes (Pro plan). Set `CRON_SECRET`. Vercel sends `Authorization: Bearer $CRON_SECRET`.
- Apply SQL in order: `migrations/0001_node_computers.sql` through `0008_stripe_events.sql`. Run `npm run migrate` only with `DATABASE_URL` set, and only after the owner approves that database change.
- Apply `migrations/0005_pair_reveals.sql` to the preview database before pull request 33 or 34 deploys. Without that column, `/setup` returns 500 for a paying customer.

## Kill switch and rollback

- Stop new purchases without a deploy: set `CHECKOUT_DISABLED=1` on the Vercel environment for this branch. `POST /api/checkout` returns 503.
- Pause Stripe deliveries in the Stripe dashboard for the webhook endpoint. The handler inserts the event id into `stripe_events` before applying it. If apply throws, that row is deleted so Stripe can retry. A row that remains is a finished delivery and the next copy of that id is skipped. `invoice.paid` does not turn a canceled seat back on.
- This launch URL is a Preview alias. Rollback is: in Vercel, point `staxions-preview.vercel.app` back at the previous deployment, or revert the commit on `cursor/aistudio-authkit-desks-a695`. Instant Rollback applies to Production deployments only.
- If this stack is merged to `main`, tag the previous tip first: `git tag pre-staxions-main 08438f55`. After the merge commit, undo it with `git revert -m 1 <merge-commit>`. Do not force-push `main`.
- Moving to `asentxia.com` later changes `APP_URL`, the WorkOS redirect, the Stripe webhook URL, and `SITE_INDEXABLE`. It does not require a code change if those four are the only host switches.
- Do not merge this branch to `main` or promote it to Production until the owner approves the exact SHA. The HANDOFF section 7 gate (test mode, then one live run, on Runloop) has not been run.

## Postgres

`DATABASE_URL` is required on Vercel and in `NODE_ENV=production`. There is no silent memory fallback there.

Use Vercel Postgres or any Neon-compatible Postgres URL (pooled or direct). The app uses the `pg` client.

Local only: omit `DATABASE_URL` and optionally set `FLOK_SEAT_STORE_PATH=.flok/seats.json`.

## Plans (edit in one file)

Draft prices live in `web/lib/billing/catalog.ts`. Stripe Price IDs are **not** hardcoded — set env vars:

| Plan | Env var | Suggested Stripe product |
|------|---------|--------------------------|
| Personal $29/mo, 1 computer, 10h | `STRIPE_PRICE_PERSONAL` | Recurring monthly Price |
| Pro $99/mo, 2 computers, 40 shared h | `STRIPE_PRICE_PRO` | Recurring monthly Price |
| Team $79 / agent / mo, min qty 3, 30h/agent | `STRIPE_PRICE_TEAM` | Recurring monthly Price, quantity at checkout |
| Enterprise | none | No checkout. “Talk to us” mailto |

Always-on is not a public plan. Checkout is a server-created Stripe Checkout Session (`POST /api/checkout`). Success/cancel URLs use `APP_URL` or the request origin — never `floks-pc.com`.

Create **test-mode** Price IDs for Preview and **live-mode** Price IDs for Production. Do not mix `pk_test` / `sk_test` with live Price IDs.

## Stripe webhook

Endpoint: `https://<this-host>/api/webhooks/stripe`

Register these events (test endpoint on Preview, live endpoint on Production):

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.paid`

Set `STRIPE_WEBHOOK_SECRET` to that endpoint’s signing secret (`whsec_…`). Preview and Production need different secrets if they use different Stripe modes.

## WorkOS AuthKit

`invalid_client: client secret from a different environment` means `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` are not from the same WorkOS environment.

| Env var | Must match |
|---------|------------|
| `WORKOS_CLIENT_ID` | Staging `client_…` **or** Production `client_…` |
| `WORKOS_API_KEY` | The `sk_…` key from **that same** Staging or Production environment |
| `WORKOS_COOKIE_PASSWORD` | ≥32 characters; same value that sealed the session |
| `WORKOS_REDIRECT_URI` | Exact allow-listed callback, e.g. `https://<preview-host>/callback` |

Preview and Production can use different WorkOS environments, but each Vercel environment must be a matched pair. Add every callback URL in the WorkOS dashboard Redirects list.

A config mismatch now renders a clear HTML error on `/callback` and `/setup?error=workos_env`.

## Env vars

### Preview (Stripe test mode + WorkOS Staging **or** a matched Production pair)

| Name | Required | Notes |
|------|----------|--------|
| `APP_URL` | yes | Public origin, e.g. `https://floks-pc-git-….vercel.app`. Not `https://floks-pc.com`. |
| `NEXT_PUBLIC_SITE_ORIGIN` | recommended | Same as `APP_URL` |
| `DATABASE_URL` | yes on Vercel | Neon / Vercel Postgres |
| `WORKOS_CLIENT_ID` | yes | Same env as the API key |
| `WORKOS_API_KEY` | yes | Same env as the client id |
| `WORKOS_COOKIE_PASSWORD` | yes | ≥32 chars |
| `WORKOS_REDIRECT_URI` | yes | `https://<preview>/callback` |
| `STRIPE_SECRET_KEY` | yes | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | yes | Test-mode endpoint `whsec_…` |
| `STRIPE_PRICE_PERSONAL` | yes to sell Personal | Test Price id `price_…` |
| `STRIPE_PRICE_PRO` | yes to sell Pro | Test Price id |
| `STRIPE_PRICE_TEAM` | yes to sell Team | Test Price id |
| `SUPPORT_EMAIL` | optional | Default `contact@asentxia.com` |
| `CRON_SECRET` | yes if cron is used | Vercel cron bearer |
| `STAXIONS_IDLE_MINUTES` | optional | Default `30` |
| `FLOK_WEB_PROVIDER` | for a real computer | `runloop` |
| `RUNLOOP_API_KEY` | with Runloop | Never expose to the browser |
| `FLOK_RUNLOOP_BLUEPRINT` | with Runloop | Interactive stack, not generic DnD |
| `FLOK_RUNLOOP_KEEP_ALIVE_SECONDS` | optional | 60–86400; default follows idle, max 1h, cron refreshes |

### Production (Stripe live + WorkOS Production)

Same names. Use `sk_live_…`, live Price ids, live webhook secret, Production WorkOS `client_…` + matching `sk_…`, and `APP_URL` for the real public host once DNS points at Vercel.

`FLOK_WEB_PROVIDER=runloop` is required before taking paid traffic. FakeProvider is refused for a paying seat when `NODE_ENV` is `production`, and only then. `VERCEL_ENV` is not that switch. Vercel Preview sets `NODE_ENV` to `production`, so a paying seat on Preview needs Runloop as well.

## After checkout

1. Stripe redirects to `/setup?session_id=…` on **this** origin.
2. The webhook writes the seat (by Price id) and tries to provision.
3. `/setup` auto-provisions any missing computers for an active seat. The customer does not click an extra “create computer” step. Pairing the Grok Bot is still Approve on `/setup`.

## Metering

`/api/cron/computers` (every 5 minutes):

- adds running time to the seat
- suspends at the included-hour cap unless overage is on
- suspends after `STAXIONS_IDLE_MINUTES` (default 30)
- shuts down on cancel or past-due
- pings Runloop `keepAlive` so the vendor 15–60 minute lifetime does not kill an in-plan session

## Founder checklist (no secrets in git)

1. Create Stripe **test** products/prices for Personal / Pro / Team. Copy the `price_…` ids into Preview env vars.
2. Add a test webhook to `/api/webhooks/stripe` with the events above. Copy `whsec_…` to Preview.
3. Provision Neon or Vercel Postgres. Set `DATABASE_URL`. Apply `0001` through `0008`, and apply `0005` before pull request 33 or 34 deploys.
4. Fix WorkOS: one Client ID + API key pair per Vercel environment. Add the Preview callback URL.
5. Set `APP_URL` to the Preview origin (not floks-pc.com).
6. For a real computer on Preview: `FLOK_WEB_PROVIDER=runloop`, `RUNLOOP_API_KEY`, `FLOK_RUNLOOP_BLUEPRINT`.
7. Set `CRON_SECRET`. Confirm the cron route on a Production deploy (Vercel crons do not run on Preview).
8. Sign in once by hand. Buy with a Stripe test card. Confirm `/setup` shows a provisioning/running computer.
9. Repeat with live keys only when you are ready to take money — not part of this PR.
