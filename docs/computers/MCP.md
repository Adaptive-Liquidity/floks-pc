# MCP Gateway (C5)

Public Bot surface for **Agent Computers**. **ComputerService** is the only path to compute. MCP / xAI account auth never authorizes computer access. Launch keeps **exactly eight tools**. Do not add tools for L1 MVP.

Live L0 proof (PR #17): a real Grok Bot called `computer_observe({ include_accessibility: true })` and received `accessibility_summary.source === "cdp"` with non-empty nodes from a Runloop Agent Computer. FakeProvider is **not** proof.

## Endpoint

```text
POST /mcp
```

Streamable HTTP, JSON-RPC 2.0.

| Protocol | Behavior |
|---|---|
| **2026-07-28** (preferred) | Stateless. `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers. `server/discover`, `tools/list`, `tools/call`. No session store. Header/body disagreement is `-32020`. |
| 2025-era (`2025-06-18`, `2025-03-26`, …) | Compatibility path: `initialize` / `notifications/initialized` / `ping` still work. `Mcp-Session-Id` may be sent and is **ignored** for identity and authorization. |

`GET` / `DELETE` return 405. C5 does not hold SSE sessions.

## How a Grok Bot connects

1. Operator provisions a computer (`ComputerService.requestComputer`) and issues a pair code (`issuePairCode`). That is control-plane, not an MCP tool.
2. Configure a Grok Bot custom MCP connector:
   - URL: `https://<host>/mcp` (`FLOK_MCP_BASE_URL`, HTTPS, not loopback)
   - **Required** wrapper header for path B: `Authorization: Bearer <FLOK_MCP_AUTH_TOKEN>`
3. The Bot calls `computer_pair` with the pair code plus its `bird_id` / `flock_id`.
4. The Bot stores `capability_token` and `computer_handle` and passes both on every later `computer_*` tool.

The existing Flok publish token at `~/flok/token` is **not** compute authority. Do not copy it into `FLOK_MCP_AUTH_TOKEN`.

**127.0.0.1 is not a real remote Grok Bot endpoint. A remote Grok Bot needs an authenticated HTTPS endpoint that forwards to the MCP server and requires FLOK_MCP_AUTH_TOKEN.**

Two paths:

- **A. Local/operator smoke:** `FLOK_MCP_LISTEN_HOST=127.0.0.1` (default). Local-only. Remote Grok Bot cannot connect. Local curl / local connector only.
- **B. Real remote Grok Bot:** operator HTTPS tunnel or reverse proxy in front of this process, `FLOK_MCP_AUTH_TOKEN` required, external MCP URL must be HTTPS. Do not expose unauthenticated public MCP. MCP does not run inside the Devbox; do not use a Runloop guest tunnel for the MCP socket.

This package does not deploy a public host. Set `FLOK_MCP_PUBLIC_URL` and `FLOK_LIVE_MCP_GROK_TEST=1` only after an approved authenticated HTTPS endpoint exists. Operator runbook: `docs/computers/REMOTE_GROK_MCP.md`.

## Auth / capability flow

```text
Grok Bot
  │  Authorization: Bearer <wrapper>     ← required on path B; connection identity only
  │  POST /mcp  tools/call computer_pair { pair_code, bird_id, flock_id }
  ▼
McpGateway
  │  throttle pair by connection (wrapper digest or unauth+IP)
  │  ComputerService.pair()              ← C4 identity + digest checks
  ▼
{ capability_token, capability_id, computer_handle, node_handle, scopes, expires_at }
  │
  │  tools/call computer_status|exec|fs|observe|act
  │    { capability_token, computer_handle, ... }
  ▼
ComputerService.authorize() → isCapabilityValid (digest, binding, scope, expiry, revoke)
  │
  ▼
ComputerProvider   (never called from the gateway)
```

- Shared xAI account MCP auth / `account_id` is metadata. It cannot status/exec/fs.
- After pairing, the **capability token** is the routing and authorization credential.
- Transport session IDs are not Bot identity.

## Tools (exactly eight)

| Tool | Service call | Notes |
|---|---|---|
| `computer_pair` | `pair()` | Returns the capability secret **once**. |
| `computer_status` | `status()` | No `providerDetail` / provider refs. |
| `computer_exec` | `exec()` | Default argv. `mode: "shell"` needs `shell` scope. stdout/stderr clipped to 64k. |
| `computer_fs` | `filesystem()` | Path jail. stat/list/read/write/mkdir/move/copy/delete. |
| `computer_observe` | `observe()` | Screenshot only when requested. Optional `include_accessibility`. Live Runloop returns `accessibility_summary.source === "cdp"` with real nodes (L0). FakeProvider is not proof. `capabilities().accessibility` stays `false`. |
| `computer_act` | `act()` | Bounded C3B actions (`open_url`, wait, coordinates, type, key, scroll). `click_element` fail-closed until L5. No VNC/takeover tool. |
| `handoff_send` | — | `PHASE_NOT_STARTED` (L6 / former C9). |
| `handoff_receive` | — | `PHASE_NOT_STARTED` (L6 / former C9). |

## Example (fake tokens only)

Pair:

```http
POST /mcp HTTP/1.1
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: computer_pair
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"computer_pair","arguments":{"pair_code":"ABCD-EFGH-JK","bird_id":"bird-noema","flock_id":"flock-adaptive"}}}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{"type": "text", "text": "{...}"}],
    "isError": false,
    "structuredContent": {
      "capability_token": "fakeTokenNotARealSecret",
      "capability_id": "cap_example",
      "computer_handle": "computer_example",
      "node_handle": "bird-noema",
      "flock_id": "flock-adaptive",
      "scopes": ["status", "exec", "fs", "observe", "act", "lifecycle"],
      "expires_at": "2026-09-21T00:00:00.000Z"
    }
  }
}
```

Status:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"computer_status","arguments":{"capability_token":"fakeTokenNotARealSecret","computer_handle":"computer_example"}}}
```

## Post-merge hardening (PR #8, on main)

- **Never-hang:** any unhandled gateway throw ends the response — sanitized JSON-RPC `500 INTERNAL` for requests, `202` (no body) for notifications. Client aborts while uploading settle immediately.
- **Protocol header honesty:** `MCP-Protocol-Version` response header is taken from the negotiated/supported version. An unsupported client-presented version is never echoed.
- **Throttle fail-closed:** pair-connection throttle evicts only expired or under-limit entries; a saturated map of throttled identities rejects unknown identities instead of letting them pass unthrottled.
- **No unvalidated Bearer identity:** caller-supplied `Authorization` is only used for throttle identity when `FLOK_MCP_AUTH_TOKEN` is configured and the Bearer already passed validation. Without wrapper auth configured, unauthenticated connections key on remote address.

## C6: Shell & Filesystem (argv + path jail)

C6 extends the MCP gateway with hardened shell and filesystem operations:

- `computer_exec`: argv[] only by default; `mode: "shell"` requires `shell` scope. Limits: argv max 64, item length 8192, cwd max 1024, timeout max 600s, env keys max 32, key length 128, value length 4096. Result includes exit_code, stdout, stderr, stdout_truncated, stderr_truncated, timed_out.
- `computer_fs`: stat, list, read, write, mkdir, move, copy, delete. Path jail at `/home/flok` (rejects ../, null bytes, /proc, /sys, /dev). Read/write bounded to 1MB. Structured errors (PATH_ESCAPE, NOT_FOUND, etc.). No host path leaks.

Both tools require valid capability with correct scope (`exec` or `fs`). Wrapper Bearer / account_id / session metadata alone cannot authorize.

L1 unpaid MCP fs and the owner-approved live Runloop fs smoke (PR #20) cover write/read/stat/list. Do not treat FakeProvider as L0/L1 product proof. Remote Grok Bot over authenticated HTTPS is a separate L1 gate (`REMOTE_GROK_MCP.md`); it is not claimed until that live checklist passes.

## Env / config

| Variable | Required for unit tests | Meaning |
|---|---|---|
| `FLOK_MCP_COMPUTERS_ENABLED` | no | Must be `1`/`true` to bind `src/mcp-server.ts` |
| `FLOK_MCP_LISTEN_HOST` | no | Default `127.0.0.1` (**path A**, local smoke). Non-loopback (`0.0.0.0` / `::`) requires `FLOK_MCP_AUTH_TOKEN`. Loopback is not a remote Grok Bot endpoint. |
| `FLOK_MCP_LISTEN_PORT` | no | Default `8787` |
| `FLOK_MCP_AUTH_TOKEN` | no | Wrapper Bearer. **Mandatory** for path B and any public/non-loopback exposure. Connection auth, not Bot compute authority. Never log it. |
| `FLOK_MCP_BASE_URL` | no | Path B Grok connector URL. Must be `https://<host>/mcp`, not loopback. Setting this without `FLOK_MCP_AUTH_TOKEN` refuses startup. |
| `FLOK_MCP_PUBLIC_URL` | no | Live Grok gate only |
| `FLOK_LIVE_MCP_GROK_TEST` | no | Opt-in live file; not CI |
| `FLOK_MCP_BOOTSTRAP` | no | Opt-in control-plane: provision one computer and print a one-time pair code to stdout. Not an MCP tool. Works with Fake (default) or Runloop when `FLOK_MCP_PROVIDER=runloop`. |
| `FLOK_MCP_BOOTSTRAP_BIRD_ID` | no | Bootstrap identity. Default `bird-local`. Must match `computer_pair`. |
| `FLOK_MCP_BOOTSTRAP_FLOCK_ID` | no | Bootstrap identity. Default `flock-local`. Must match `computer_pair`. |
| `FLOK_MCP_PROVIDER` | no | Default `fake`. Set `runloop` only with owner approval and `RUNLOOP_API_KEY`. FakeProvider is not Agent Computer / L0 proof. |
| `FLOK_RUNLOOP_BLUEPRINT` | for Runloop | **Required for a paid Agent Computer:** `flok-runloop-interactive` (or an equivalent owner-validated interactive stack: `flok-ui`, Xvfb, Chrome, loopback CDP). Generic `runloop/universal-ubuntu-24.04-x86_64-dnd` is compute-only and is **not** an Agent Computer. L1 must fail **before** accepting a paid computer if this is missing/wrong. Do not treat missing Xvfb as success. |
| `FLOK_RUNLOOP_KEEP_ALIVE_SECONDS` | no | Timeout fallback 60–3600 (default 900). **Not** the cleanup path. `Ctrl+C` / MCP stop does not destroy the Devbox. |
| `FLOK_CONTROL_PLANE_PATH` | no | Durable JSON store for ComputerRecord / pair / capability digests. Runloop MCP defaults to `.flok/control-plane.json`. Fake stays in-memory unless this is set. Raw tokens are never stored. |
| `FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY` | no | Opt-in for C3A live compute tests only. Agent Computer MCP must not set this. |

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 npm run start:mcp
```

Default provider for that process is **FakeProvider**. Paid Runloop (`FLOK_MCP_PROVIDER=runloop`) is not started here and is **not** part of required PR CI. See README for the owner-approved Agent Computer snippet.

**MCP cannot stop or destroy a Devbox.** None of the eight tools call `ComputerService.stop()` / `destroy()`. `computer_status` never returns a provider id. Paid-machine cleanup is the Runloop shutdown runbook in `docs/computers/agent-computer-cloud.md`. Only shut down the Devbox created by this FLOKS run. Never bulk-shutdown all Devboxes returned by the Runloop account. Do not add a ninth tool for L1. Do not publish real provider IDs.

## Logging

The gateway redacts `pair_code`, `capability_token`, `Authorization`, and API-key fields. Do not log raw pair codes or capability secrets anywhere else either.

## SDK note

C5 implements a tools-only Streamable HTTP surface (2026-07-28 + 2025-era initialize) without vendoring `@modelcontextprotocol/server`. That keeps secret redaction, connection throttling, and “session is not identity” under this package’s control. Clients still speak standard JSON-RPC `tools/list` / `tools/call`.
