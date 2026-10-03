# Security — Agent Computer

This is fail-closed **launch** security, not a claim of production-ready multi-tenant security. Do not claim residential proxies, bot-detection bypass, full root, or an uncensored terminal.

## Core principles

1. **Private by default, explicit sharing by design.**
2. **Capability-based access.** Account-level MCP authentication cannot identify which Grok Bot is calling (xAI team deployments share MCP auth). Pairing + capability tokens are mandatory.
3. **Fail closed.** Illegal state transitions, expired codes, revoked capabilities, path escapes, and cross-Node access all reject.
4. **No secrets in the guest.** Provider API keys (`RUNLOOP_API_KEY`), long-lived credentials, and Flok capability tokens never enter a Node VM or appear in MCP responses / audit content.
5. **Metadata-only audit.** Terminal output, screenshots, cookies, and page contents are not persisted by default. C3B temporary screenshot files are deleted after collection.
6. **Browser profiles are Node-private.** `/home/flok-ui/.flok-browser` (Chrome profile, cookies, screenshots) is `flok-ui` `0700` under a root-owned `0755` parent, outside the flok-owned workspace. Reserved from every bot tool (`computer_fs`, `computer_exec`). Leftover `/home/user/flok/.browser` is quarantined on ensure and never adopted. Never copy it between Nodes. Never put control-plane secrets in it.

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

C5 (MCP gateway) tools call `ComputerService` — never a provider, never skip the capability check. MCP wrapper auth and session IDs are not Bot identity. Pairing is throttled per MCP connection (wrapper bearer digest or unauth+IP). See `docs/computers/MCP.md`.

## C6: Shell & Filesystem Hardening

- `computer_exec`: argv[] enforced (no shell strings by default). `mode: "shell"` requires `shell` scope. Limits: argv count ≤64, item length ≤8192, cwd ≤1024, timeout ≤600s, env keys ≤32, key length ≤128, value length ≤4096. Result includes exit_code, stdout, stderr, stdout_truncated, stderr_truncated, timed_out. No stack traces, provider refs, host paths, pair codes, capability tokens, Authorization headers, or provider keys in responses.
- `computer_fs`: stat, list, read, write, mkdir, move, copy, delete as `flok` (OS permissions apply). Path jail at `/home/user/flok`: rejects ../, null bytes, `/proc`, `/sys`, `/dev`, `/var/lib/flok`, `/run/flok-cdp`, leftover `.flok`, leftover `.browser`, and `/home/flok-ui/.flok-browser`. Opens with an `openat` walk (`O_NOFOLLOW|O_DIRECTORY` per component from the workspace root) as the same user — no resolve-then-act as root, no parent-dir symlink follow. Writes stream the body on stdin (never argv) so a 1MB file does not hit Linux `MAX_ARG_STRLEN`. Each write uses a unique `/var/lib/flok/fs-spec-<uuid>.json`. Read/write bounded to 1MB; above that returns `FILE_TOO_LARGE`. Structured errors (PATH_ESCAPE, PERMISSION_DENIED, NOT_FOUND, FILE_TOO_LARGE, MISSING_CONTENT, UNSUPPORTED). No host path leaks.
- Capability required for every operation. `exec` scope for argv exec, `shell` scope for shell mode, `fs` scope for filesystem. Wrapper Bearer / account_id / session metadata alone cannot authorize.
- Cross-Node denial: capability bound to exact computer_id + bird_id + flock_id. Revoked/expired/missing capability denied.
- No secrets in responses or logs: pair codes, capability tokens, Authorization headers redacted.

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
used. Browser profile `/home/flok-ui/.flok-browser/profile` is `700` and owned by
`flok-ui` under a root-owned `0755` `/home/flok-ui`. Sticky `1775` on the
workspace does **not** protect a `.browser` name there: `flok` owns that
directory, so the kernel exempts it from the sticky rule. Chrome therefore
lives outside the workspace. A leftover or planted `/home/user/flok/.browser`
is quarantined (`*.quarantine-<ts>`) on ensure/wake and never adopted as
`--user-data-dir`. An untrusted pre-existing `/home/flok-ui/.flok-browser`
without a root `.flok-root` marker is quarantined the same way; chown/chmod
use `O_DIRECTORY|O_NOFOLLOW` fds (`fchown`/`fchmod`), not a path. Old
computers keep working (fresh profile). Root screenshot helpers refuse to
follow symlinks (`openat` + `O_NOFOLLOW`). Bots cannot read cookies or the
profile through `computer_fs` or `computer_exec`. Screenshots and profile
management stay on internal control-plane paths. x11vnc/noVNC bind
`127.0.0.1` only.

## Guest privilege split

Three identities on a paid Agent Computer:

| Identity | Role |
|----------|------|
| `root` | Control plane only: ensure, CDP helpers, Devbox DnD. Never the bot default. |
| `flok-ui` (uid 1500) | Xvfb, Openbox, Chrome, screenshots, xdotool. |
| `flok` (uid 1501) | Default for `computer_exec` and `computer_fs`. Home / cwd `/home/user/flok`. |

**Sudo is not offered.** There is no passwordless sudo, no `sudoers.d` drop-in, and `flok` is not in group `sudo`. `sudo` / `su` / `pkexec` fail closed. This is a product decision, not a missing feature.

Control-plane helpers (`execvp.py`, `ensure-interactive.sh`, `cdp-ax.mjs`, `cdp-nav.mjs`) live in `/var/lib/flok` (root:root, mode `0700`). They are not in the customer workspace file view and are not readable, writable, or deletable by `flok`. Leftover `/home/user/flok/.flok` from older computers is removed on ensure. `/run/flok-cdp` stays root `0700`. Customer writes are done as `flok` (no post-write root `chown`). Lazy ensure uses `chown -h` / `--no-dereference` and `chown -hP -R` so planted symlinks to `/etc` or `/var/lib/flok` are not followed.

Existing computers created before this change do **not** need a blueprint rebuild. `ensureBotUser()` runs on provision, wake, exec, and fs: it creates `flok` if missing, locks `/var/lib/flok`, and deletes leftover workspace helpers. If `useradd` / `runuser` cannot create the user, the operation fails closed with a clear error instead of staying root.

Blueprint definition changes that add `flok` to the image are optional documentation of the desired end state. **Do not rebuild the blueprint for this change.**

Authenticated takeover (single-use, short-lived signed URL) is **deferred**, not L0/L1. Never exposes provider credentials. C7/L0 landed loopback CDP observe only; it did **not** land VNC.

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
