# Private beta (L3)

Minimal safety caps. **Not L7** (no billing ledger, worker queue, OpenTelemetry, fleet kill-switch, or provider scheduler).

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
