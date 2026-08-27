# Remote Grok Bot MCP (authenticated HTTPS)

Local loopback is **operator smoke**. A real remote Grok Bot needs **authenticated HTTPS**. This document is the L1 runbook for that path. It does **not** claim private beta readiness.

**127.0.0.1 is not a real remote Grok Bot endpoint. A remote Grok Bot requires authenticated HTTPS. `FLOK_MCP_AUTH_TOKEN` is mandatory for public/non-loopback exposure.**

Do not add MCP tools. Do not expose unauthenticated public MCP. Do not run paid Runloop without owner approval.

## Two paths

| Path | What it is | Grok Bot |
|------|------------|----------|
| **A. Local smoke** | MCP listens on `127.0.0.1` (default). Wrapper token optional. | Cannot connect from xAI. Local curl / local connector only. |
| **B. Remote Grok Bot** | Same MCP process on loopback. Operator puts a **TLS reverse proxy or HTTPS tunnel** in front. `FLOK_MCP_AUTH_TOKEN` required. `FLOK_MCP_BASE_URL=https://<host>/mcp`. | Connector URL is that HTTPS `/mcp`. Header `Authorization: Bearer <token>`. |

MCP stays on the operator host. Do not run MCP inside the Runloop guest. Do not pick a single tunnel vendor here.

Startup fail-closed:

- Non-loopback listen host without `FLOK_MCP_AUTH_TOKEN` → refuse to bind.
- `FLOK_MCP_BASE_URL` set without HTTPS, or pointing at loopback, or path not `/mcp`, or missing `FLOK_MCP_AUTH_TOKEN` → refuse to start.

Wrong or missing Bearer on the public path → HTTP `401` `UNAUTHORIZED`. The body does not include the token.

Connection auth (`FLOK_MCP_AUTH_TOKEN`) is **not** Bot compute authority. After pair, every `computer_*` call still needs the capability token.

## Operator start (path B)

Keep MCP on loopback. Put HTTPS in front. Example shape (vendor-neutral):

```text
Grok Bot  --HTTPS+Bearer-->  operator TLS terminator  -->  127.0.0.1:8787 POST /mcp
```

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_MCP_PROVIDER=runloop \
FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive \
FLOK_MCP_LISTEN_HOST=127.0.0.1 \
FLOK_MCP_AUTH_TOKEN="<wrapper-bearer>" \
FLOK_MCP_BASE_URL="https://<operator-https-host>/mcp" \
FLOK_MCP_BOOTSTRAP=1 \
FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local \
FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local \
npm run start:mcp
```

Grok Bot custom MCP connector:

- URL: `https://<operator-https-host>/mcp`
- Header: `Authorization: Bearer <FLOK_MCP_AUTH_TOKEN>`

Do not commit the token. Do not log it. Do not put `RUNLOOP_API_KEY` in the guest, the MCP JSON-RPC body, or chat.

Local smoke (path A) remains:

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_MCP_LISTEN_HOST=127.0.0.1 \
npm run start:mcp
```

## Live smoke checklist (owner-approved)

Do **not** run paid Runloop unless the owner explicitly approves. Unpaid verify never starts a Devbox.

When approved, test only this minimum:

1. MCP is listening on loopback; TLS terminator is HTTPS; `FLOK_MCP_BASE_URL` is `https://…/mcp`.
2. Missing Bearer → `401`. Wrong Bearer → `401`. Correct Bearer → MCP JSON-RPC.
3. Grok Bot connector uses the HTTPS URL + Bearer.
4. `computer_pair` with the bootstrap pair code / `bird_id` / `flock_id`.
5. `computer_status` works.
6. `computer_observe` works (screenshot or CDP AX as already proven on L0; no `click_element`).
7. `computer_fs` mkdir / write / read / stat / list on `/home/user/flok`.
8. Capture `providerRef` from this run. Shut down **only** that Devbox. MCP cannot destroy. `Ctrl+C` does not.

```bash
FLOK_MCP_PROVIDER=runloop \
FLOK_CONTROL_PLANE_PATH=.flok/control-plane.json \
FLOK_DESTROY_CONFIRM=1 \
FLOK_DESTROY_PROVIDER_REF="<captured-providerRef-from-this-run>" \
npm run computers:destroy-run
```
9. Confirm logs have no wrapper token, pair code, capability token, or `RUNLOOP_API_KEY`.

Exactly eight tools. No takeover/VNC, no C8 snapshots, no C9 handoffs, no Nexus/AEON/Graphiti.

Opt-in file (does not deploy, does not start Runloop):

```bash
FLOK_LIVE_MCP_GROK_TEST=1 \
FLOK_MCP_PUBLIC_URL="https://<operator-https-host>/mcp" \
FLOK_MCP_AUTH_TOKEN="<wrapper-bearer>" \
npm run test:live:mcp
```

## Not claimed

- Private beta / L3
- That `127.0.0.1` is a remote Grok Bot endpoint
- Unauthenticated public MCP
- A hosted FLOKS cloud
