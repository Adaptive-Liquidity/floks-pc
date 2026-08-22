# MCP Gateway (C5)

Public Bot surface for Flok Computers. **ComputerService** is the only path to compute. MCP / xAI account auth never authorizes computer access.

## Endpoint

```
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
   - URL: `https://<host>/mcp` (`FLOK_MCP_BASE_URL`)
   - Optional wrapper header: `Authorization: Bearer <FLOK_MCP_AUTH_TOKEN>`
3. The Bot calls `computer_pair` with the pair code plus its `bird_id` / `flock_id`.
4. The Bot stores `capability_token` and `computer_handle` and passes both on every later `computer_*` tool.

The existing Flok publish token at `~/flok/token` is **not** compute authority. Do not copy it into `FLOK_MCP_AUTH_TOKEN`.

Real Grok Bot pairing through a public URL is a **manual** gate. This package does not deploy. Set `FLOK_MCP_PUBLIC_URL` and `FLOK_LIVE_MCP_GROK_TEST=1` only after an approved public HTTPS endpoint exists.

## Auth / capability flow

```
Grok Bot
  │  Authorization: Bearer <wrapper>     ← optional, connection identity only
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
| `computer_observe` | `observe()` | Screenshot only when requested. No fabricated accessibility. |
| `computer_act` | `act()` | Bounded C3B actions. No VNC/takeover tool. |
| `handoff_send` | — | `PHASE_NOT_STARTED` (C9). |
| `handoff_receive` | — | `PHASE_NOT_STARTED` (C9). |

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

## Env / config

| Variable | Required for unit tests | Meaning |
|---|---|---|
| `FLOK_MCP_COMPUTERS_ENABLED` | no | Must be `1`/`true` to bind `src/mcp-server.ts` |
| `FLOK_MCP_LISTEN_HOST` | no | Default `127.0.0.1` |
| `FLOK_MCP_LISTEN_PORT` | no | Default `8787` |
| `FLOK_MCP_AUTH_TOKEN` | no | Optional wrapper Bearer. Connection auth, not Bot auth. |
| `FLOK_MCP_BASE_URL` | no | Public URL to document for Grok (e.g. `https://host/mcp`) |
| `FLOK_MCP_PUBLIC_URL` | no | Live Grok gate only |
| `FLOK_LIVE_MCP_GROK_TEST` | no | Opt-in live file; not CI |

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 npm run start:mcp
```

Default provider for that process is **FakeProvider**. Paid Runloop is not started here.

## Logging

The gateway redacts `pair_code`, `capability_token`, `Authorization`, and API-key fields. Do not log raw pair codes or capability secrets anywhere else either.

## SDK note

C5 implements a tools-only Streamable HTTP surface (2026-07-28 + 2025-era initialize) without vendoring `@modelcontextprotocol/server`. That keeps secret redaction, connection throttling, and “session is not identity” under this package’s control. Clients still speak standard JSON-RPC `tools/list` / `tools/call`.
