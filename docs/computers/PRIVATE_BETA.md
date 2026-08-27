# Private beta (L3)

Minimal safety caps. **Not L7** (no billing ledger, worker queue, OpenTelemetry, fleet kill-switch, or provider scheduler).

**L0–L3 is enough to run a real private-beta bot.** L4 (checkpoints / recovery) is optional insurance — merge PR #24 only if the owner says merge; do not wait for L4–L9. Do not start L5 / Team Computers / billing by default. Shared Team Computers are deferred: `TEAM_COMPUTERS.md`.

## Enable

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_BETA_ENABLED=1 \
FLOK_OWNER_ID=owner-example \
FLOK_CONTROL_PLANE_PATH=.flok/control-plane.json \
FLOK_BETA_MAX_ACTIVE=1 \
FLOK_BETA_IDLE_TTL_MS=1800000 \
npm run start:mcp
```

Then on the loopback console (`http://127.0.0.1:8788`):

```bash
# Waitlist, then approve (operator only)
curl -sS -X POST http://127.0.0.1:8788/operator/v1/beta/waitlist \
  -H 'content-type: application/json' \
  -d '{"ownerId":"owner-example"}'
curl -sS -X POST http://127.0.0.1:8788/operator/v1/beta/approve \
  -H 'content-type: application/json' \
  -d '{"ownerId":"owner-example"}'
```

Without `FLOK_BETA_ENABLED`, local FakeProvider smoke is unchanged.

## Caps

| Control | Default | Notes |
|---------|---------|--------|
| Invite/approval | required when beta is on | Waitlist does not grant a computer |
| Max active computers | 1 (`FLOK_BETA_MAX_ACTIVE` 1–5) | Non-deleted machines on this owner/service |
| Idle auto-shutdown | 30 minutes | Destroys idle machines (confirm+captured ref internally) |
| Durable store | required | In-memory is local/dev only |

Cost is a **warning**, not a meter. Provider IDs stay out of debug packets.

## Operator routes (loopback)

- `GET /operator/v1/limitations`
- `GET /operator/v1/debug-packet`
- `GET /operator/v1/beta`
- `POST /operator/v1/beta/waitlist`
- `POST /operator/v1/beta/approve`

Eight MCP tools unchanged. See `docs/computers/KNOWN_LIMITATIONS.md` and `.github/ISSUE_TEMPLATE/bug_report.md`.

JSON POSTs require `Content-Type: application/json`. Missing `Origin` is allowed; a non-loopback `Origin` is rejected.

## One real private-beta session

Do **not** start paid Runloop unless the owner approves this run. FakeProvider is local smoke only — not product proof. Remote MCP stays authenticated HTTPS (`REMOTE_GROK_MCP.md`). Operator console stays loopback.

1. **Enable beta** with the env block above (`FLOK_BETA_ENABLED=1`, durable `FLOK_CONTROL_PLANE_PATH`, `FLOK_OWNER_ID`). For a real Agent Computer also set `FLOK_MCP_PROVIDER=runloop` and `FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive`.
2. **Invite owner** — `POST /operator/v1/beta/waitlist` with `{ "ownerId": "<owner>" }` from loopback.
3. **Approve owner** — `POST /operator/v1/beta/approve` with the same `ownerId`. Waitlist does not grant a computer.
4. **Pair Grok Bot** — remote HTTPS `POST /mcp` with wrapper Bearer + `computer_pair` (capability token after pair). See `REMOTE_GROK_MCP.md`.
5. **Create Agent Computer** — pairing / `requestComputer` provisions one isolated machine for that `bird_id`. Default remains one bot, one computer.
6. **Observe** — `computer_observe` (screenshot and/or CDP AX). `click_element` stays fail-closed.
7. **Files / exec** — `computer_fs` write/read/stat/list and `computer_exec` under `/home/user/flok`.
8. **Operator console watch** — `http://127.0.0.1:8788/console`. Confirm bot, computer, state, last action, cost warning, cap. Do not tunnel this port.
9. **Idle auto-shutdown** — unused machines destroy after `FLOK_BETA_IDLE_TTL_MS` (default 30 min) using confirm + captured `providerRef`.
10. **Cleanup** — if the box is still up, destroy **only** this run’s captured `providerRef` (console destroy or `npm run computers:destroy-run`). MCP cannot destroy. `Ctrl+C` does not. Never bulk-shutdown the Runloop account.

Keep the capability token, wrapper Bearer, pair code, and `RUNLOOP_API_KEY` out of logs, chat, and debug packets. Record live provider IDs as `dbx_REDACTED`.
