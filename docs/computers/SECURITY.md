# Security — Flok Node Computer

## Core principles

1. **Private by default, explicit sharing by design.**
2. **Capability-based access.** Account-level MCP authentication cannot identify which Grok Bot is calling (xAI team deployments share MCP auth). Pairing + capability tokens are mandatory.
3. **Fail closed.** Illegal state transitions, expired codes, revoked capabilities, path escapes, and cross-Node access all reject.
4. **No secrets in the guest.** Provider API keys (`RUNLOOP_API_KEY`), long-lived credentials, and Flok capability tokens never enter a Node VM or appear in MCP responses / audit content.
5. **Metadata-only audit.** Terminal output, screenshots, cookies, and page contents are not persisted by default. C3B temporary screenshot files are deleted after collection.
6. **Browser profiles are Node-private.** `/home/user/flok/.browser/profile` is guest state in the workspace jail. Never copy it between Nodes. Never put control-plane secrets in it.

## Pairing

- Separate from Flok’s existing six-character join code.
- Format: `ABCD-EFGH-JK` (32-char alphabet, 10 chars, ≥ 50 bits entropy).
- One-use, 10-minute TTL, per-code attempt limit.
- Pairing failures (including digest misses and omitted `sharedAuth`) count against the presented Node identity (`bird_id`+`flock_id`), not against a shared MCP account id. A single shared-account key must not lock pairing for every Bot.
- C4 does **not** deliver a verified-caller brute-force limiter. C5 must throttle `computer_pair` by authenticated connection/caller identity.
- Bound to the computer’s exact `computer_id` + `bird_id` + `flock_id` at issue time.
- Redeeming requires the presented Node identity to match that binding.
- Only the digest is stored. The raw code is returned once from `issuePairCode`.
- Shared account / MCP auth may be attached to `pair()` (C5 will have it) but does **not** authorize issuance.

## Capabilities

- 256-bit random tokens (`randomBytes(32)`, base64url).
- Only SHA-256 digests are stored. The raw secret is returned once from `pair()`.
- Bound to exact `computer_id` + `bird_id` + `flock_id`.
- Explicit scopes, expiry, and `revoked_at`.
- Default pair scopes: `status`, `exec`, `fs`, `observe`, `act`, `lifecycle`.
- `shell` is **not** granted by default (`mode: "shell"` requires it in addition to `exec`).
- Every Bot-facing computer operation goes through `ComputerService` and requires a valid capability with the right scope.
- Shared account / MCP authentication is never sufficient on its own.
- Cross-Node use is rejected (`CROSS_NODE_DENIED`) even when both Bots share the same account MCP connection.
- Deleting a computer revokes its capabilities and burns outstanding pair codes.

C5 (MCP gateway) is not implemented here. C5 tools must call `ComputerService` — never a provider, never skip the capability check.

## Path jail

Every filesystem operation:

- Canonicalizes the path.
- Rejects `../`, symlink escape, device files, `/proc`, `/sys`, provider control paths.
- Default allowed root: `/home/flok` (or equivalent workspace).

## Network policy (defaults)

- Inbound deny
- Public ports deny
- Metadata endpoints deny
- Cross-Node deny
- Later self-host: outbound default deny + explicit allowlist

## Credentials

- Browser credentials: human types them during takeover; Flok never stores the password.
- API credentials: service-specific `CredentialBroker` in the control plane. The Node sees a capability (e.g. `github.repo.read`), never the raw token.
- No casual `.env` files inside Node computers for secrets owned by the platform.

## Handoffs

Allowed: documents, code, images, archives, structured JSON.  
Never automatically transferred: browser profiles, cookies, SSH keys, `.env`, credential stores, Flok capability tokens.

## Takeover (VNC)

C3B installs localhost-only x11vnc + noVNC (`127.0.0.1:6080`). That is **not** a public takeover URL.

- `takeover()` stays fail-closed until an authenticated Runloop tunnel exists.
- `vnc` capability stays `false` until that contract is actually satisfied.
- Never use `auth_mode=open` as the production takeover mechanism.
- Tunnel URLs/credentials are sensitive; do not log them.

C3B Chrome runs as dedicated non-root user `flok-ui` (uid 1500). The DnD
Devbox remains root so Docker-in-Docker still works. `--no-sandbox` is not
used. Browser profile `/home/user/flok/.browser/profile` is `700` and owned by
`flok-ui`. x11vnc/noVNC bind `127.0.0.1` only.

Later (C7): single-use, short-lived signed URL. Never exposes provider credentials.

## Provider secrets

`RUNLOOP_API_KEY` (and future Kata/Firecracker credentials) live only in the control-plane environment.  
Never print the key or metadata about it (including length) in CI logs.

Secret scanning (Gate C10) must prove they never appear in:

- Node environment
- Workspace
- Terminal output logs
- MCP logs
- Audit table
- Pulse / public surfaces

## Audit

`computer_audit_events` stores only:

- operation, target class, timestamps, success, error code, trace_id, optional receipt_id

No private content.
