# Staxions Stripe go-live checklist

Seller: **Asentxia Inc.** Support: **contact@asentxia.com**

This file is the owner switch from Stripe **TEST** to **LIVE**. Switching live is keys, Price IDs, the webhook secret, and a portal configuration — not a code change.

Do **not** set live keys from a code PR. Do **not** apply `migrations/0010_billing_grace.sql` to a live database from a PR. Vercel Cron does **not** run on Preview.

## Exact env var names

| Name | TEST (Preview) | LIVE (Production) |
|------|----------------|-------------------|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | test endpoint `whsec_…` | live endpoint `whsec_…` |
| `STRIPE_PRICE_PERSONAL` | test Price id `price_…` | live Price id for Personal $29 |
| `STRIPE_PRICE_PRO` | test Price id | live Price id for Pro $99 |
| `STRIPE_PRICE_TEAM` | test Price id | live Price id for Team $79/seat |
| `STRIPE_PORTAL_CONFIGURATION_ID` | test Customer Portal configuration | live configuration that allows plan, quantity, cancel |
| `STAXIONS_BILLING_GRACE_HOURS` | optional, default `72` | same name; default 72 hours |
| `STAXIONS_BIND_SECRET` | ≥32 chars; signs bot checkout links | new value on Production |
| `CHECKOUT_DISABLED` | `1` to stop new checkouts | same |
| `APP_URL` | Preview origin | public origin |

Draft catalog amounts live in `web/lib/billing/catalog.ts`. Never hard-code a live Price id in git.

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

Signature must verify (`Stripe-Signature` + `STRIPE_WEBHOOK_SECRET`). Duplicate deliveries are skipped by event id in `stripe_events` (Postgres when `DATABASE_URL` is set). Unsigned bodies are refused in production.

## Customer Portal (dashboard)

Create a Customer Portal configuration that allows:

- Plan switch among Personal / Pro / Team prices
- Quantity updates (Team seats)
- Cancel at period end
- Invoice history and payment-method update

Put that configuration id in `STRIPE_PORTAL_CONFIGURATION_ID`. Stripe emails receipts when “Successful payments” emails are on in the Stripe dashboard. The app does not send receipts.

## Migration file (do not apply from this PR)

`migrations/0010_billing_grace.sql` adds `grace_until` and `billing_event_at` on `billing_seats`. Apply only after the owner approves that database, after `0009_pending_binds.sql`.

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
