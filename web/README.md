# floks-pc.com public frontend

UI-only source for the public FLOKS site: pay, connect, status, revoke.

This package does **not** change pairing, MCP tools, Stripe webhooks, GCP, env secrets, or the hour-meter. Production stays on the live host until an owner merges and deploys.

## What this is

- Routes: `/`, `/join`, `/setup`, `/callback`, `/oauth/authorize`, `/legal` + existing policy pages, 404 / 5xx. FLOKS product door only. Footer may credit Asentxia Systems. No Architecture/Systems/Research/Evidence/Company routes or nav.
- Look: Stitch product UI on live routes — ground `#131313`, neon lime `#d3fd64`, glass modules, Space Grotesk / Geist / JetBrains Mono. Not a second app, not a dumped mock folder.
- Pay: existing Stripe Payment Links
- Setup unauthenticated: magic-link gate. `session_id` never mints a cookie
- Setup authenticated: desk UI against `GET /setup` JSON if the host returns it; otherwise the gate. `?preview=` is labeled preview
- Actions post to live `/setup/approve|deny|portal|logout|resend|callback`
- Allow is only `/oauth/authorize`

## Run

```bash
cd web
npm ci
npm run dev      # http://127.0.0.1:3173
npm run verify   # typecheck + build
```

Do not deploy from this folder without owner approval.
