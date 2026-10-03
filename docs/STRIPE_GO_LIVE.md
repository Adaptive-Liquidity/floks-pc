# Staxions Stripe go-live checklist

Seller: **Asentxia Inc.** Support: **contact@asentxia.com**

This file is the owner switch from Stripe **TEST** to **LIVE**. Switching live is keys, Price IDs, the webhook secret, and a portal configuration — not a code change.

Do **not** set live keys from a code PR. Do **not** apply `migrations/0010_billing_grace.sql` to a live database from a PR. Vercel Cron does **not** run on Preview.

## Exact env var names

| Name | TEST (Preview) | LIVE (Production) |
|------|----------------|-------------------|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | test endpoint `whsec_…` | live endpoint `whsec_…` |
| `STRIPE_PRICE_PERSONAL` | test Price id `price_…` | live Price id for Personal. Pricing to be confirmed. |
| `STRIPE_PRICE_PRO` | test Price id | live Price id for Pro. Pricing to be confirmed. |
| `STRIPE_PRICE_TEAM` | test Price id | live Price id for Team. Pricing to be confirmed. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | test Customer Portal configuration | live configuration that allows plan, quantity, cancel |
| `STAXIONS_BILLING_GRACE_HOURS` | optional, default `72` | same name; default 72 hours |
| `STAXIONS_BIND_SECRET` | ≥32 chars; signs bot checkout links | new value on Production |
| `CHECKOUT_DISABLED` | `1` to stop `POST /api/checkout` and `POST /buy` | same |
| `APP_URL` | Preview origin | public origin |

Public copy does not state a dollar amount. Unapproved draft cent figures stay in `web/lib/billing/internal-draft-prices.ts` and are not rendered. Never hard-code a live Price id in git.

## Webhook

URL (Preview): `https://<this-host>/api/webhooks/stripe`  
URL (later public host): `https://<public-host>/api/webhooks/stripe`

Subscribe to:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

Signature must verify (`Stripe-Signature` + `STRIPE_WEBHOOK_SECRET`). Duplicate deliveries are skipped by event id in `stripe_events` (Postgres when `DATABASE_URL` is set). After `0010`, rows carry `status` + `claimed_at`: `processing` is 409 to other workers, `done` is skip, `failed` or a `processing` lease older than five minutes can be retried. Unsigned bodies are refused in production. Provision and bot bind run before the handler returns 200. If they throw, the event is marked failed and the handler returns 500 so Stripe retries.

Refund and dispute: a partial refund does not change seat status. A full refund is treated as canceled (grace, then sleep, files kept). A dispute opened marks `past_due`. A dispute won restores `active` if the subscription is otherwise active.

## Customer Portal (dashboard)

Create a Customer Portal configuration that allows:

- Plan switch among Personal / Pro / Team prices
- Quantity updates (Team seats)
- Cancel at period end
- Invoice history and payment-method update

Put that configuration id in `STRIPE_PORTAL_CONFIGURATION_ID`. Stripe emails receipts when “Successful payments” emails are on in the Stripe dashboard. The app does not send receipts.

## Migration file (do not apply from this PR)

`migrations/0010_billing_grace.sql` adds `grace_until` and `billing_event_at` on `billing_seats`, `failed_at` / `fail_reason` on `pending_binds`, and `status` / `claimed_at` on `stripe_events`. Existing `stripe_events` rows are backfilled `done`; new rows default to `processing` with `claimed_at` now. Apply it for 72-hour grace, durable bind-failure banners, and the five-minute webhook lease. The app stays up without it: `/setup`, login, and the Stripe webhook keep reading and writing seats. Without `0010`, grace is zero (`past_due` / `canceled` are held immediately), bind failures fall back to `used_at` only (used + no live binding still shows the reconnect banner), and webhook ids are insert-or-skip. After `0010`, `used_at` alone is not a reconnect signal. A `past_due` or `canceled` seat with a live binding does not show reconnect. Lease SQL is always tried first (no cached “no lease columns” path). A pre-`0010` claim returns no `claimed_at`; `complete` / `release` then update or delete by id. Complete and release with a token only run for that claimant (`WHERE id = $1 AND claimed_at = $2`, and release also matches a null `claimed_at`). During the deploy window, rows written by older code after `0010` default to `processing`, so a redelivery gets 409 for five minutes and is then reprocessed (idempotent). If the database already recorded the r4-era `0010` file (`status DEFAULT 'done'`), re-running this file will not change the default — apply `ALTER TABLE stripe_events ALTER COLUMN status SET DEFAULT 'processing'` by hand. A negative grace-column probe is retried after 60 seconds. An already-bound bot on Stripe retry is success, not a reconnect banner.

Apply only after the owner approves that database, after `0009_pending_binds.sql`. Do not apply `0010` from this PR.

## One real TEST-mode purchase

1. Set Preview env to **test** keys and **test** Price ids. Redeploy.
2. Apply pending SQL on the Preview database (including `0010` only after owner approval).
3. In Stripe, add the Preview webhook URL and copy `whsec_…` to `STRIPE_WEBHOOK_SECRET`.
4. Sign in on Preview. Buy Personal with a Stripe test card (`4242…`).
5. Confirm Stripe shows a paid Checkout Session and a subscription.
6. Confirm `/setup` shows a computer for that buyer after the webhook (or after reload if the webhook is slightly behind).
7. If the buy started from a bot link, confirm that Bot can call `computer_status` without reconnecting.
8. Open **Manage billing**. Change nothing, then cancel at period end. Confirm the seat stays until Stripe sends `customer.subscription.deleted`.
9. Trigger a test payment failure. Confirm a 72-hour grace, then sleep with files kept — not an immediate delete.
10. Pay again. Confirm access resumes.

## One real LIVE purchase (owner only)

Repeat the TEST steps with live keys, live Price ids, a live webhook endpoint, and a real card for **one** Personal seat. Confirm the receipt email from Stripe. Then cancel or refund that seat from the Stripe dashboard if it was only a go-live probe.

## Preview limits

Vercel Cron does not run on Preview. Grace, suspend, and resume must happen on the webhook, `/setup`, and the next computer use. Do not treat cron as a Preview requirement.
