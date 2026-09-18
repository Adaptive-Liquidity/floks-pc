# floks-pc.com public frontend

Next.js App Router for the public FLOKS site: marketing, AuthKit account, Stripe pay, /setup desks.

## What this is

- Look: AI Studio glass/dark luxury — ground `#050505`, ice `#e3f2fd`, Hanken Grotesk / Manrope / JetBrains Mono.
- Routes: `/`, `/join`, `/product`, `/how`, `/now`, `/faq`, `/legal` + policies, `/setup`, `/signup`, `/login`, `/callback`, `/logout`, `/oauth/authorize`.
- Journey: create account or sign in → buy a computer → manage on `/setup`.
- Pay: existing Stripe Payment Links (Spark / Desk / Shift). Unsigned plan CTAs go to `/signup`. Signed-in links pass `prefilled_email`.
- Auth: WorkOS AuthKit Magic Auth. `/login` uses `screen_hint=sign-in`. `/signup` and `/login?screen=sign-up` use `screen_hint=sign-up`. Sealed httpOnly `wos-session`. Never invent a cookie from `session_id`.
- Seats: Stripe webhook or verified checkout email, bound to the signed-in WorkOS email. Signed-in with no seat stays on `/setup` (empty account + buy CTAs).
- Desks: `ComputerService` + FakeProvider by default. Runloop only when documented env is set. See `LIVE.md`.
- Vercel Root Directory is `web`. Domain deps (`zod`, `@runloop/api-client`) live in this package so `../src` resolves without a root `npm install`.
- `/setup?preview=` is ignored in production. `FLOK_WEB_PREVIEW=1` is dev-only.

## Run

```bash
cd web
npm ci
npm run dev      # http://127.0.0.1:3173
npm run verify   # typecheck + build
```

Copy `web/.env.example` for names only. Do not commit secrets. Do not deploy to production from this folder without owner approval.
