# Designed-AI-Studio skin on the live floks-pc.com door

> **For agentic workers:** Skin the existing Next `web/` door with the local `designed-aistudio` look. Do not replace live pay, magic-link, pair, Allow, or portal contracts. Do not mount a second Vite app. Do not merge or deploy.

**Goal:** Make `designed-aistudio` the displayed UI/UX for every existing floks-pc.com surface, while the live host functions stay the only working pieces.

**Architecture:** `designed-aistudio` is a visual reference pack only. Production functions already live on floks-pc.com (Stripe Payment Links, `POST /setup/*`, `GET`/`POST /oauth/authorize`, `/mcp`). The in-repo public UI is the Next App Router under `web/`. Port look (tokens, type, plates, landing composition) onto those routes. Do not add routes. Do not change pairing, MCP tools, Stripe webhooks, GCP, env secrets, or the hour-meter.

**Tech Stack:** Next.js 15 App Router in `web/`, TypeScript strict, existing `web/lib/setup-client.ts` and `web/lib/config.ts` contracts.

## Global Constraints

- Product door routes only: `/`, `/join`, `/setup`, `/callback`, `/oauth/authorize`, `/legal` + seven policy pages, 404 / 5xx.
- Live Stripe Payment Links stay exactly: Spark `https://buy.stripe.com/dRm5kv54s8FO5NR0ES6wE00`, Desk `https://buy.stripe.com/dRm00b9kI2hqfor3R46wE01`, Shift `https://buy.stripe.com/eVq28j7cA5tCccf1IW6wE02`.
- Setup actions stay `POST` to `/setup/approve|deny|pair|portal|billing|logout|resend|connector|callback`.
- Manage billing is a real browser form `POST /setup/portal` (live 302s to Stripe Customer Portal). Never `fetch` + `redirect: follow` for portal.
- Magic-link finish: await `POST /setup/callback`, then replace `/setup`. `session_id`-only is just-paid check-inbox — do not POST. No 900ms timer that can skip finish.
- Allow is only `/oauth/authorize`. Incomplete/error GET (live 400 `invalid_client` / `unsupported_response_type` / PKCE required) never shows Allow.
- `session_id` never mints a cookie. Humans never see capability tokens. `user_code` is the only human-visible pair identity.
- Locked copy in `web/lib/copy.ts` stays unless the owner replaces a string in this plan. Do not revive “Your Grok Bot gets its own computer.”, waitlist, Crew/Always, Log In product, or thesis nav.
- Footer may credit “Asentxia Systems” as text only (not a route). No Architecture / Systems / Research / Evidence / Company pages.
- At most one KitMark on `/` and `/join`. Zero on legal, 404, Allow.
- Node ≥ 22.12 < 23. TypeScript strict, no `any`.
- Do not enable Nexus-IQ / AEON / Graphiti. Do not start L6 / L7 / L8 / G0.
- Do not merge. Do not deploy to production. Live floks-pc.com stays the old host until an owner deploys `web/`.

## Out of scope (whole plan)

- Do not serve `designed-aistudio` or a Vite app as floks-pc.com.
- Do not add routes, AuthKit login, waitlist, `/account`, `/docs`, `/pair`, or a second checkout.
- Do not change pairing, MCP tools, Stripe webhooks, GCP, env secrets, or the hour-meter.
- Do not merge or deploy.

---

## Step 1 — Inventory the AI Studio pack against the live door

**Intent:** Read local `designed-aistudio/` (and root `vite.config.ts` if present) as reference only. Map every designed screen to an existing locked route. List leftovers that must not become routes.

**Files:** `designed-aistudio/**`, `web/app/**`, `web/lib/copy.ts`, `web/lib/config.ts`, `tests/web/public-site.test.ts`

**Acceptance:**

- Written inventory: each designed screen → `/` `/join` `/setup` `/callback` `/oauth/authorize` `/legal*` or “unused visual, do not route”.
- Confirm the pack is not mounted as the Next app and no new `web/app/<name>` folders are created.

**Out of scope:** Do not serve `designed-aistudio` or a Vite app as floks-pc.com. Do not add routes.

---

## Step 2 — Port visual tokens into the existing Next door

**Intent:** Move the designed landing’s color, type, glass, radius, and kit rules into `web/app/globals.css` and `web/app/layout.tsx` without changing routes or copy contracts.

**Files:** `web/app/globals.css`, `web/app/layout.tsx`, `web/lib/kit.ts`, `web/components/KitMark.tsx`, `tests/web/public-site.test.ts`

**Acceptance:**

- Designed tokens applied on the existing Next shell (header FLOKS + Support/Policies or authed Manage billing/Logout; legal footer).
- `npm run typecheck --prefix web` and `tests/web/public-site.test.ts` still pass route/copy/token locks (or the lock file is updated only for intended token diffs).

**Out of scope:** Do not add routes. Do not replace Payment Links or setup POST helpers.

---

## Step 3 — Skin landing `/` and `/join`, keep pay working

**Intent:** Display the designed landing composition on `/` and `/join` only. Pay still uses the three live Stripe Payment Links via `PayPills`. `/join` still shows “Give this URL to the Bot you paid for.”

**Files:** `web/app/page.tsx`, `web/app/join/page.tsx`, `web/components/PayPills.tsx`, `web/components/Door.tsx`, `web/components/HonestyStrip.tsx`, `web/lib/copy.ts`, `web/lib/config.ts`

**Acceptance:**

- `/` and `/join` show the designed landing look.
- Plan CTAs still href the three live `buy.stripe.com` links above.
- `/join` still includes `JOIN_LINE`. At most one KitMark on each page.
- No new public routes.

**Out of scope:** Do not add waitlist, Log In, or a custom checkout.

---

## Step 4 — Skin `/setup` gate and desk, keep session and POST contracts

**Intent:** Apply the same designed chrome to the magic-link gate and authenticated desk. Keep fail-closed session rules and live setup POSTs.

**Files:** `web/app/setup/page.tsx`, `web/components/SetupGate.tsx`, `web/components/SetupDesk.tsx`, `web/components/SetupSessionUpgrade.tsx`, `web/components/SiteHeader.tsx`, `web/lib/session.ts`, `web/lib/setup-client.ts`

**Acceptance:**

- Unauth `/setup` still shows the magic-link gate (never labeled Allow). `session_id`-only is just-paid check-inbox and does not POST.
- Approve / Deny still `POST /setup/approve` and `/setup/deny` with `user_code`. Paste fallback stays collapsed after those buttons (“Approve isn’t working.”).
- Manage billing still submits a real form `POST /setup/portal`. Logout still `POST /setup/logout`.

**Out of scope:** Do not change pairing, MCP tools, Stripe webhooks, GCP, env secrets, or the hour-meter.

---

## Step 5 — Skin `/callback`, Allow, legal, and 404 without changing protocol

**Intent:** Restyle remaining locked surfaces. Callback still awaits finish. Allow stays fail-closed. Legal paths and honesty copy stay.

**Files:** `web/components/CallbackFlash.tsx`, `web/components/AuthorizeCard.tsx`, `web/lib/oauth.ts`, `web/app/oauth/authorize/page.tsx`, `web/app/legal/**`, `web/app/not-found.tsx`, `web/app/error.tsx`, `web/lib/legal.ts`

**Acceptance:**

- `/callback` has no `setTimeout` / 900ms hop. Other query keys `await finishCallback` then replace `/setup`.
- Allow renders only after `res.ok` and a valid success shape. Live incomplete GET (400 JSON) shows human error / invalid_client, never Allow.
- Legal stays at `/legal` + terms/privacy/aup/refund/cancellation/retention/support. 404 stays “This page isn’t here.”

**Out of scope:** Do not add routes. Do not merge or deploy.

---

## Step 6 — Lock tests and typecheck the skinned door

**Intent:** Prove the designed look is on the existing door and that live contracts did not regress.

**Files:** `tests/web/public-site.test.ts`, `web/README.md`

**Acceptance:**

- `node --experimental-vm-modules node_modules/tsx/dist/cli.mjs --test tests/web/public-site.test.ts` is green.
- `npm run typecheck --prefix web` is green.
- Tests still lock: no forbidden routes; Stripe links; callback/portal/Allow contracts; kit + paste fallback.

**Out of scope:** Do not merge or deploy. Do not run paid live Stripe or destroy Devboxes.
