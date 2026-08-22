# Security — Flok Node Computer

## Core principles

1. **Private by default, explicit sharing by design.**
2. **Capability-based access.** Account-level MCP authentication cannot identify which Grok Bot is calling (xAI team deployments share MCP auth). Pairing + capability tokens are mandatory.
3. **Fail closed.** Illegal state transitions, expired codes, revoked capabilities, path escapes, and cross-Node access all reject.
4. **No secrets in the guest.** Provider API keys, long-lived credentials, and Flok capability tokens never enter a Node VM or appear in MCP responses / audit content.
5. **Metadata-only audit.** Terminal output, screenshots, cookies, and page contents are not persisted by default.

## Pairing

- Separate from Flok’s existing six-character join code.
- Format recommendation: `ABCD-EFGH-JK` (≥ 50 bits entropy).
- One-use, short TTL (e.g. 10 minutes), rate-limited.
- Only the digest is stored.

## Capabilities

- 256-bit random tokens.
- Only digests stored in Postgres.
- Scoped to one `computer_id` + `bird_id`.
- Explicit expiry + revocation.
- Cross-Node use is rejected even when both Bots share the same account MCP connection.

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

- Single-use, short-lived signed URL.
- Never exposes provider credentials.
- Expires quickly.

## Provider secrets

`DAYTONA_API_KEY` (and future Kata/Firecracker credentials) live only in the control-plane environment.  
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
