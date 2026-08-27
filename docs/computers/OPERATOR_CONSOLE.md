# Live Node Console (L2)

Operator UI for **Bot Computers**. Not an MCP tool. Not a Bot capability surface. FakeProvider is not Agent Computer proof.

## Where it runs

Same process as MCP (`npm run start:mcp`), **different socket**. MCP stays on `FLOK_MCP_LISTEN_PORT` (default 8787). The console binds `127.0.0.1:8788` by default. Set `FLOK_OPERATOR_LISTEN_PORT` to override the console port (not the MCP port). A Grok HTTPS tunnel to `/mcp` must not forward this port. The Bot wrapper token is not operator auth.

| Path | What |
|------|------|
| `GET /console` | Live Node Console HTML (loopback) |
| `GET /operator/v1/snapshot` | Bots, computers, metadata-only events |
| `POST /operator/v1/computers/:id/observe` | Control-plane observe (no Bot token). Paused/waking/recovering → `OBSERVE_RETRYABLE`. |
| `POST /operator/v1/computers/:id/checkpoint` | Provider-native workspace checkpoint (L4) |
| `POST /operator/v1/computers/:id/wake` | Wake + health probe (L4) |
| `POST /operator/v1/computers/:id/pause` | Pause (L4) |
| `POST /operator/v1/computers/:id/recover` | Restore latest checkpoint (L4). Fails closed if none. |
| `POST /operator/v1/computers/:id/destroy` | Selected computer only; `confirm: true` + captured `providerRef` |

`POST /mcp` is unchanged. Eight tools. Destroy is still not an MCP tool. Operator routes refuse `X-Forwarded-For` / `Forwarded` / `CF-Connecting-IP`.

## Auth

- Loopback peer only. The Grok `FLOK_MCP_AUTH_TOKEN` cannot destroy through `/operator/v1`.
- That is not a remote Grok Bot endpoint.

## What you should see

A non-engineer can answer:

1. This bot has this computer
2. It is running (or sleeping / stopped)
3. This is what it sees (viewport + CDP/accessibility; screenshot only if the provider returns one, never persisted)
4. These are its permissions (scopes, expiry)
5. This is how I stop it (confirm + captured providerRef for **this** computer)

Event log records pair, status, observe, browser, file, exec, fail-closed, cleanup. Metadata only — no screenshots, terminal output, cookies, or page contents.

L4 adds checkpoint status, recovery notes, and cleanup-needed on the same loopback console. See `docs/computers/RELIABILITY_RECOVERY.md`.

## Not in this console

New MCP tools, `click_element`, takeover/VNC, C9 handoffs, Nexus/AEON/Graphiti, billing meters (L7), paid Runloop in required CI.