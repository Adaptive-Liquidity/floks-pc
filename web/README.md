# Staxions public frontend

Next.js App Router for the public Staxions site: marketing, AuthKit account, Stripe Checkout, `/setup` desks.

## What this is

- Look: AI Studio glass/dark luxury — ground `#050505`, ice `#e3f2fd`, Hanken Grotesk / Manrope / JetBrains Mono.
- Routes: `/`, `/pricing`, `/join`, `/product`, `/how`, `/now`, `/faq`, `/legal` + policies, `/setup`, `/signup`, `/login`, `/callback`, `/logout`, `/oauth/authorize`.
- Journey: create account or sign in → buy on `/pricing` → computer auto-provisions → manage on `/setup`.
- Pay: server-created Stripe Checkout Sessions (`STRIPE_PRICE_PERSONAL` / `_PRO` / `_TEAM`). Unsigned plan CTAs go to `/signup`. Enterprise is contact us. Public pages say pricing is to be confirmed.
- Auth: WorkOS AuthKit Magic Auth. `/login` uses `screen_hint=sign-in`. `/signup` uses `screen_hint=sign-up`. Sealed httpOnly `wos-session`. Never invent a cookie from `session_id`.
- Seats: Stripe webhook (by Price id) or verified checkout email. `/setup` auto-provisions the computer for an active seat.
- Desks: Runloop when configured. FakeProvider is local/dev only and is refused for paying seats on Vercel/production.
- Vercel Root Directory is `web`. `web/vercel.json` also installs the repo root so `../src` can resolve `zod`.
- `/setup?preview=` is ignored in production. `FLOK_WEB_PREVIEW=1` is dev-only.

Env checklist, webhook events, and WorkOS pairing: **`docs/DEPLOY.md`**. Plan shape: **`web/lib/billing/catalog.ts`**. Unapproved draft cent figures, not rendered: **`web/lib/billing/internal-draft-prices.ts`**.

## Run

```bash
cd web
npm ci
npm run dev      # http://127.0.0.1:3173
npm run verify   # typecheck + build
```

Copy `web/.env.example` for names only. Do not commit secrets. Do not deploy to production from this folder without owner approval.
