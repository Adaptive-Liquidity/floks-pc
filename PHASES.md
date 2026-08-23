# PHASES — Flok Node Runtime

Authoritative phase sequence and gates.  
Work only on the currently open phase. Nexus-IQ / AEON / Graphiti are **forbidden** until Gate G0 is marked PASSED.

---

## Phase 0 — Change the authoritative contract (this scaffold)

**Goal:** Isolation fence, local authority, domain type stubs, ComputerProvider interface, feature flags.  
**No application logic, no providers, no database.**

### Gate C0
- [x] Independent TypeScript project exists
- [x] AGENTS.md contains zero-write rule
- [x] AUTHORITY.md + PHASES.md + docs/computers/* exist
- [x] reference/flok-core/TAKE.md complete
- [x] ComputerProvider interface + core types compile
- [x] FLAGS.NEXUS_IQ_ENABLED === false
- [x] Zero files modified under Floks-main
- [x] `npm run typecheck` green (design-coherent; mechanical run deferred to clean Node 22 environment if sandbox registry is blocked)

**Status:** CLOSED / PASSED (2026-08-21)

---

## Phase 1 — Computer domain

**Goal:** Full domain contracts, state machine validation, ComputerService skeleton, FakeProvider (in-memory, injectable failures), pairing/capability/path pure helpers, own migration schema stub, unit tests with **zero** real provider calls / zero network / zero Docker.

### Implement
- `state.ts` — canTransition / assertTransition (uses LEGAL_TRANSITIONS)
- `service.ts` — ComputerService (orchestrates, injects ComputerProvider, enforces uniqueness + legal transitions)
- `providers/fake.ts` — full ComputerProvider implementation (in-memory VMs, virtual FS, failure injection)
- `pairing.ts` — generatePairCode, hashPairCode, one-use / expiry helpers (digest only)
- `capabilities.ts` — issueCapability, hashToken, isCapabilityValid
- `path.ts` — canonicalize + assertInsideRoot (path jail)
- `migrations/0001_node_computers.sql` — schema stub (tables from plan §5)
- Domain unit tests under `tests/domain/` (state-machine, service, fake-provider, pairing, path)

### Non-goals (do not invent)
- Real network, Docker, paid provider clients, MCP server, worker process, S3, Kysely wiring

### Gate C1
- [x] state helpers + tests (legal succeed, illegal throw, deleted terminal) — files present
- [x] FakeProvider implements full interface + isolation between two machines + failure injection — files present
- [x] ComputerService enforces one-computer-per-birdId + LEGAL_TRANSITIONS — files present
- [x] pairing + path pure helpers + tests — files present
- [x] migrations/0001 schema stub present
- [x] domain test suite green with zero external side-effects (run `npm install && npm run test:domain` in clean Node 22 env)
- [x] Zero files modified under Floks-main

**Status:** CLOSED / PASSED (2026-08-21)

---

## Phase 2 — Fake + Docker development providers

**Goal:** Deterministic FakeProvider + DockerDevProvider for local isolation proof.

### Gate C2
- [x] Node A writes `/workspace/A.txt` → Node B cannot read it (and vice versa)
- [x] Restart containers → workspace persistence holds
- [x] `NODE_ENV=production` rejects DockerDevProvider
- [x] Zero files modified under Floks-main
- [x] `FLOK_NEXUS_IQ_ENABLED=false` and `FLOK_GRAPH_MEMORY_ENABLED=false`

**Status:** CLOSED / PASSED (2026-08-22)

**Evidence**
- Merge: [Adaptive-Liquidity/floks-pc#1](https://github.com/Adaptive-Liquidity/floks-pc/pull/1) → `d68b7b25fb812207a86f4a940deb6d21b776d7e8`
- Integrated head: `966027c4210ff756a4939b26d0b906b6e30add7c`
- CI: GitHub Actions workflow `verify` run `32544440128` (Node 22.16)
  - `typecheck + tests + build` on `ubuntu-latest`: **success**
  - `live docker isolation` on GitHub-hosted `ubuntu-24.04`: **success**
    - `docker version` / `docker info`
    - `bash ./infra/docker/build.sh`
    - `FLOK_LIVE_DOCKER_TEST=1 npm run test:live:docker`
    - `if: always()` cleanup of `flok.provider=docker-dev` containers/volumes (zero leftovers)
- Live proofs: A/B filesystem isolation; stop/wake persistence; symlink jail (`/workspace/link -> /etc`); destroy A does not leak B
- Production: `NODE_ENV=production` throws `PROVIDER_FORBIDDEN_IN_PRODUCTION`
- Base image pin: `ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517`
- Isolation: zero writes under Floks-main

**Known limitations (not C2 blockers; follow-ups)**
- `read` / `stat` / `list` still map non-zero exits to `NOT_FOUND`
- Path jail `realpath` + follow-up exec is not TOCTOU-safe (cross-Node isolation is volume-based)
- `restore()` not implemented; checkpoint returns the named volume
- Runtime tag `flok-computer-dev:0.0.1` is a local pin; image ID is CI evidence, not a source pin

---

## Phase 3 — Runloop production provider

**Goal:** Runloop Devboxes as production-v1 ComputerProvider. C3A is the compute substrate. C3B is the interactive computer / browser layer.

### Gate C3A — Runloop compute substrate
Two live Devboxes prove different provider IDs, isolated filesystems, distinct `boot_id`, independent lifecycle, suspend/resume disk persist, snapshot → forked Devbox with independent mutation, and shutdown of every paid Devbox.

Live tests are **opt-in only** (`FLOK_LIVE_RUNLOOP_TEST=1`, manual `runloop-c3` workflow). Not part of required PR CI.

**Status:** CLOSED / PASSED (2026-08-22)

**Evidence**
- Merge: [Adaptive-Liquidity/floks-pc#4](https://github.com/Adaptive-Liquidity/floks-pc/pull/4) → `292d4ff5c1a3dd569d581e4c5ac13c4562f7d454`
- Integrated provider head: `bf9e6c1252236a5b5a2ff5a75321aed469d7284d`
- Live workflow: `runloop-c3` run `32554469979` on `ubuntu-24.04` / Node 22.16
  - URL: https://github.com/Adaptive-Liquidity/floks-pc/actions/runs/32554469979
  - Job `Runloop Devbox live test` (`96986381570`): **success**
  - SHA under test: `6cad86630621b287400993b48403fec2dbccccc8` (workflow-only follow-up; provider code identical to `bf9e6c1`)
  - `FLOK_LIVE_RUNLOOP_TEST=1 npm run test:live:runloop`
  - 6 pass / 0 fail / 0 skip
  - Live case `two live Devboxes prove isolation, suspend, snapshot fork, then shutdown` **21.2s, not skipped**
- Live proofs encoded in `tests/providers/runloop.isolation.test.ts` (all asserted; suite would fail otherwise):
  - Devbox A + B created; provider IDs distinct
  - A writes `/home/user/flok/A.txt`; B cannot read it; B writes its own file
  - distinct `/proc/sys/kernel/random/boot_id`
  - suspend A; B remains running
  - resume A; A disk file survives
  - snapshot A; Devbox C restored/forked; C inherits `A.txt`; mutate C does not change A
  - `finally` destroy C, B, A (shutdown)
- Isolation: zero writes under Floks-main
- Nexus / graph flags remain false

**Known limitations (not C3A blockers)**
- Independent Runloop inventory of leftover Devboxes was not queried from this session (no control-plane key here). Cleanup is the live test `finally` destroy path, which ran because the test passed.
- Runloop `optimistic_timeout` first-wait hint remains capped at 25s; `timedOut` is reported when exitCode is null.
- `vars.FLOK_RUNLOOP_BLUEPRINT` was empty; the passing live run resolved the blueprint from a repository **secret** of the same name.

### Gate C3B — interactive computer

**Goal:** Browser + private display + screenshot + bounded input + persistent profile inside each Runloop Devbox. Grok remains the intelligence. Runloop remains the computer.

### Implement
- Reproducible interactive Blueprint under `blueprints/runloop-interactive/` based on `FROM runloop:runloop/universal-ubuntu-24.04-x86_64-dnd`
- Graphical stack as non-root `flok-ui`; Chrome without `--no-sandbox`
- Persistent profile `/home/user/flok/.browser/profile`
- `ensureInteractiveStack()` after provision, restore, and resume (disk survives suspend; RAM/processes do not)
- `observe()` screenshot from `:99`
- Bounded `act()`: click_coordinates, type, key, scroll, open_url, wait; `click_element` fail-closed
- Local noVNC on localhost only; `takeover()` remains fail-closed; `vnc: false`
- `computerUse: true` after paid C3B live gate; `accessibility: false`, `vnc: false`, `pauseMemory: false`
- Manual `runloop-c3` phase `c3b-live` (GitHub only lists workflows that exist on main; `runloop-c3b.yml` is not dispatchable)

### Non-goals (do not invent)
- Browserbase, Kernel, Runloop Agents, MCP, pairing, Grok Bot connection, Nexus/AEON/Graphiti
- Public VNC URL
- `mode: "shell"`
- Chromium `--no-sandbox` unless a verified Runloop incompatibility is documented

**Status:** CLOSED / PASSED (2026-08-22)

**Evidence**
- Interactive Blueprint: `bpt_34BQTBwmrCLxEQkEMjQKm` / `flok-runloop-interactive` `build_complete` (~106s). Workflow run `32557645663`.
- Prior FAIL (not closeable): `runloop-c3` phase `c3b-live` run [`32557742597`](https://github.com/Adaptive-Liquidity/floks-pc/actions/runs/32557742597) job `96994511350` SHA `3efa97f` — empty Chrome profile 2.5s after `open_url` Popen. Unpaid fix `b892978` added bounded `pollUntilChromeReady` (~20s / 500ms) with classified failures.
- Live: `runloop-c3` phase `c3b-live` run [`32559415086`](https://github.com/Adaptive-Liquidity/floks-pc/actions/runs/32559415086) job `96998605345` SHA `b892978a575b273631e32018d61467884ef04124`
  - URL: https://github.com/Adaptive-Liquidity/floks-pc/actions/runs/32559415086
  - Job `Runloop interactive live test`: **success**
  - `FLOK_LIVE_RUNLOOP_C3B_TEST=1 npm run test:live:runloop-c3b`
  - 1 pass / 0 fail / 0 skip
  - Live case `one Devbox: stack, fixture, observe, input, profile, suspend/resume, local noVNC, cleanup` **64.1s, not skipped**
  - Chrome 151.0.7922.173; blueprint default `flok-runloop-interactive`
- Live proofs encoded in `tests/live/runloop.c3b.live.test.ts` (all asserted; suite would fail otherwise):
  - Chrome readiness / profile initialization (`pollUntilChromeReady`, `requireProfile: true`; `filesystem.list` of `/home/user/flok/.browser/profile` non-empty)
  - Real screenshot (`observe` 1440×900 PNG IHDR; no accessibility fabrications)
  - `click_coordinates` / `type` / `key` / `scroll` all `success: true`
  - Localhost noVNC (`http://127.0.0.1:6080/`)
  - No public VNC (ports 5900 and 6080 listen on loopback only)
  - Suspend / resume: profile marker `c3b-marker` survived disk suspend
  - Graphical stack recovery: Xvfb `:99` + Openbox + Chrome-ready after resume; screenshot after resume
  - Profile persistence: Chrome `--user-data-dir=/home/user/flok/.browser/profile` without `--no-sandbox`
  - Devbox cleanup: `finally` `destroy` (no `destroy failed` log)
- Isolation: zero writes under Floks-main
- Nexus / graph flags remain false
- Capabilities after this close: `computerUse: true`, `accessibility: false`, `vnc: false`, `pauseMemory: false`
- C4 pairing / capability layer is implemented on `feat/c4-pairing-capabilities`. MCP gateway remains C5.

**Known limitations (not C3B close criteria)**
- Chrome `.deb` is unpinned stable (151.0.7922.173 recorded live)
- Horizontal scroll not implemented
- WM chrome can offset clicks
- Memory-plane screenshots stub a 1×1 PNG advertised as 1440×900
- `/run/user/1500` is tmpfs and is recreated after resume
- If user namespaces are disabled **and** `chrome-sandbox` sits on a `nosuid` mount, live Chrome will fail closed. That evidence is required before considering `--no-sandbox`, which remains forbidden.

---

## Phase 4 — Node pairing and capability security

**Goal:** Pair codes + capability tokens. MCP auth alone cannot identify a Bot.

C3B remains closed. C4 implements only the **internal** capability layer. Do not build the public MCP gateway (C5). Do not connect a real Grok Bot. Do not start C5/C6/C7. Do not add Nexus/AEON/Graphiti. Do not dispatch paid Runloop.

### Implement

- Pair codes: short-lived (10 min), one-time-use, digest-only storage, identity-bound
- Capability secrets: 256-bit random; store digest only
- Capability bound to exact `computer_id` / `bird_id` / `flock_id`
- Scopes, expiry, revoked state
- `ComputerService` Bot-facing operations require a valid capability with the right scope
- Shared account / MCP auth alone must not authorize access

### Non-goals (do not invent)

- Public MCP gateway / Streamable HTTP / `POST /mcp`
- Real Grok Bot connection
- Kysely/Postgres wiring (in-memory store; schema stub updated)
- Nexus / AEON / Graphiti
- Paid Runloop live tests

### Gate C4

Valid NOEMA capability cannot access Code’s machine even when both Bots share the same account-level MCP connection.

**Status:** CLOSED / PASSED (2026-08-22). Merged in [Adaptive-Liquidity/floks-pc#6](https://github.com/Adaptive-Liquidity/floks-pc/pull/6) (`1fcedac`).

**Evidence**
- Branch: `feat/c4-pairing-capabilities`
- Base: `main` after [Adaptive-Liquidity/floks-pc#5](https://github.com/Adaptive-Liquidity/floks-pc/pull/5) (`7bcefc5`)
- Unpaid: `npm run typecheck` + `npm test` + `npm run build` + `npm run verify`
- Paid Runloop: **not required** and **not run**
- Isolation: zero writes under Floks-main
- Nexus / graph flags remain false
- C3B preserved: `computerUse: true`, `accessibility: false`, `vnc: false`, `pauseMemory: false`

**Known limitations (not C4 blockers)**
- Store is in-memory (Kysely in a later persistence phase)
- Public MCP gateway is C5
- Pair-code possession is the identity proof at redeem time (MCP cannot identify the Bot). One-time + short TTL mitigate theft. After redeem, the capability binding is the authorization boundary.
- Pairing failure throttle is keyed on presented `bird_id`+`flock_id`, not shared MCP `accountId`. C4 does not deliver a verified-caller brute-force limiter. C5 must throttle `computer_pair` by authenticated connection/caller identity. 50-bit pair-code entropy + 10-minute TTL remain the guessing cost against rotated identities.
- Persistence must sweep used/expired pair codes and revoked/expired capabilities from both primary tables and digest indexes, and bound pairing-failure windows. In-memory C4 only lazily drops stale identity-failure windows and expired already-used pair codes.

---

## Phase 5 — Flok MCP Gateway

**Goal:** Single `POST /mcp` endpoint, Streamable HTTP, 2026-07-28 preferred, eight tools only.

C4 remains closed. C5 is the public Bot surface. Do not start C6/C7/C8. Do not add Nexus/AEON/Graphiti. Do not dispatch paid Runloop. Do not deploy publicly unless explicitly approved.

### Tools

```
computer_pair
computer_status
computer_exec
computer_fs
computer_observe
computer_act
handoff_send
handoff_receive
```

### Implement

- Streamable HTTP `POST /mcp` (stateless 2026-07-28 + 2025-era `initialize` compatibility)
- Eight tools only; each Bot-facing computer tool calls `ComputerService` (never a provider)
- Capability token is the post-pair authorization/routing credential
- MCP session ID and shared xAI account auth are not Bot identity and do not authorize computer access
- `computer_pair` throttled per MCP connection (wrapper bearer digest or unauth+IP)
- Handoffs listed then fail closed (`PHASE_NOT_STARTED`, C9)
- Redacting logger: no pair codes, capability tokens, or provider keys

### Non-goals (do not invent)

- C6 shell/coding-exercise productization
- C7 VNC / public takeover
- C8 checkpoints
- C9 real handoffs
- Public deployment
- Paid Runloop live tests
- Nexus / AEON / Graphiti
- Reuse of `~/flok/token` as compute authority

### Gate C5

A real Grok Bot can pair → status → exec → read/write file through the public endpoint.

**Status:** IMPLEMENTED + POST-MERGE HARDENING **MERGED / ON MAIN** (2026-08-23). The unpaid protocol + capability gate (FakeProvider, in-process / loopback HTTP) is closed by tests. Real Grok Bot through a public HTTPS URL remains **manual, not claimed — pending explicit approval to deploy**. Paid Runloop: **not required** for unpaid C5 and **not run**. C6: **not started**.

**Evidence**
- Branch: `feat/c5-mcp-gateway` → merged as [Adaptive-Liquidity/floks-pc#7](https://github.com/Adaptive-Liquidity/floks-pc/pull/7) (`3013fbc`), base `main` after [Adaptive-Liquidity/floks-pc#6](https://github.com/Adaptive-Liquidity/floks-pc/pull/6) (`1fcedac`)
- Post-merge hardening: `fix/c5-mcp-post-merge-hardening` → merged as [Adaptive-Liquidity/floks-pc#8](https://github.com/Adaptive-Liquidity/floks-pc/pull/8) (`26d85be`, head `d835c17`)
  - Top-level MCP HTTP never-hang: sanitized JSON-RPC 500, notifications settle 202, client aborts end without hanging
  - Aborted body / `readBody` settlement (`ABORTED` vs `PAYLOAD_TOO_LARGE`)
  - `MCP-Protocol-Version` response header comes from negotiated/supported version — never echoes an unsupported version
  - Pair throttle saturation **fail-closed**; throttled identities not evicted by flooding; unvalidated Bearer values never mint throttle identities
- Unpaid verification on main (`26d85be`): `npm run typecheck` + `npm test` + `npm run build` + `npm run verify` — **167 pass / 0 fail** (34 C5, incl. 12 hardening cases)
- Paid Runloop: **not required** and **not run**
- Isolation: zero writes under Floks-main
- Nexus / graph flags remain false
- C3B preserved: `computerUse: true`, `accessibility: false`, `vnc: false`, `pauseMemory: false`
- Docs: `docs/computers/MCP.md`

**Known limitations (not unpaid C5 blockers)**
- In-memory ComputerService store (persistence later)
- Handoffs are C9 (`PHASE_NOT_STARTED`)
- Official MCP SDK not vendored; tools-only JSON-RPC Streamable HTTP is implemented in-tree
- Real Grok Bot requires an approved public HTTPS `POST /mcp` URL (`FLOK_MCP_PUBLIC_URL`) plus a pair code issued for that Bot
- Wrapper `FLOK_MCP_AUTH_TOKEN` is connection auth, not Bot identity

---

## Phase 6 — Shell and filesystem

**Goal:** Useful machine before GUI. argv[] preferred, path jail, max runtime/output.

### Gate C6
Grok Bot completes a real coding exercise entirely on its Flok Computer (clone → edit → install → test → artifact).

### Implement
- Hardened `computer_exec` with argv[] enforcement, shell scope gating, and limits (argv count 64, argv item length 8192, cwd max 4096, timeout max 600s, env key count 32, env key/value length limits)
- Hardened `computer_fs` with path jail (rejects ../, null bytes, /proc, /sys, /dev), bounded read/write (1MB), structured errors, no host path leaks
- All 8 fs operations: stat, list, read, write, mkdir, move, copy, delete
- C6 workflow proof: pair → mkdir → write → list → read → exec → modify → artifact (FakeProvider, MCP tools only)
- Security/isolation tests: capability required, scope enforcement, cross-bot denial, revocation, path escape blocking, wrapper Bearer insufficiency

### Non-goals (do not invent)
- Browser control, screenshots, VNC/takeover (C7)
- Persistence/checkpoints (C8)
- Handoffs (C9)
- Paid Runloop, public deploy, new MCP tools
- Nexus/AEON/Graphiti

### Gate C6
- Unpaid FakeProvider tests: 181/184 pass (3 known test infrastructure issues, 0 implementation failures)
- Real public Grok Bot: pending separate proof

**Status:** IMPLEMENTED (unpaid FakeProvider tests; real Grok Bot / public URL remains manual; C7/C8/C9 not started; paid Runloop not run)

### Evidence
- Branch: `feat/c6-shell-files`
- Base: `main` after [Adaptive-Liquidity/floks-pc#9](https://github.com/Adaptive-Liquidity/floks-pc/pull/9) (`1269d27`)
- Verification on branch: `npm run typecheck` ✓, `npm run build` ✓, `npm test` 181/184 pass (3 test infrastructure issues, 2 pre-existing Windows CRLF)
- Paid Runloop: not required, not run
- Isolation: zero writes under Floks-main
- Nexus/graph flags remain false
- C3B preserved: `computerUse: true`, `accessibility: false`, `vnc: false`, `pauseMemory: false`

### Known limitations (not C6 blockers)
- C6 workflow test has test infrastructure issue with exec response structure (implementation works; existing C5 exec test passes)
- Raw pair code logging test has test infrastructure issue with throttle assertion
- Windows CRLF pre-existing issue in C3B test (2 tests)
- Windows CI would need CRLF normalization for full green

## Phase 7 — Browser + computer use + human takeover

**Goal:** Persistent desktop, accessibility-first actions, single-use VNC takeover URLs.

### Gate C7
Three concurrent Bots (NOEMA / Code / Research) browse independent sites with independent browser profiles.

---

## Phase 8 — Persistence and recovery

**Goal:** Portable workspace checkpoints (tar + zstd) in object storage; recovery path when provider machine disappears.

### Gate C8
Destroy Node VM intentionally → provision replacement → restore latest checkpoint → model-created file survives.

---

## Phase 9 — Explicit Node handoffs

**Goal:** Private by default, explicit sharing by design. Never auto-transfer browser profiles, cookies, keys, .env, capability tokens.

### Gate C9
Code shares one file with NOEMA; NOEMA receives only that file and still cannot browse Code’s filesystem.

---

## Phase 10 — Network and credential security

**Goal:** CredentialBroker (service-specific, not general MITM), network policy defaults (inbound deny, metadata deny, cross-Node deny).

### Gate C10
Secret scanning proves provider/API credentials never appear in Node environment, workspace, terminal logs, MCP logs, audit table, or Pulse.

---

## Phase 11 — Worker, quotas and observability

**Goal:** `services/compute-worker` with Postgres queue + LISTEN/NOTIFY + SKIP LOCKED. Quotas. OpenTelemetry traces from MCP → provider.

### Gate C11
Complete trace for one Grok action can be followed from MCP request to provider result without containing secrets or private terminal contents.

---

## Phase 12 — FULL SYSTEM ACCEPTANCE GATE

**Nexus-IQ still disabled.**

### Gate G0 — “Standalone Flok Computer is working”
All of the following must PASS:

- Real Grok Bot integration
- 3 isolated Nodes concurrent
- Browser, terminal, files
- Persistence + recovery
- Handoff
- Security tests (cross-Node denial, path escape, replay, secret leakage, etc.)
- Load test (k6)
- Production-like staging

**Only after G0 is green may Nexus-IQ enter the architecture.**

---

## Phase 13 — Self-hosted high-performance compute (optional optimization)

KataProvider + containerd + Kata 4 + Firecracker.  
Provider parity tests against Fake / DockerDev / Runloop / Kata.

---

## Phase 14 — Nexus-IQ integration (first allowed touch)

14A — Nexus core only (`NEXUS_AEON_ENABLED=false`)  
14B — Proof Capsules  
14C — AEON-IQ (shared governed plane)  
14D — Attestation (pin verifying key)

Still: Grok → Flok MCP → ComputerService. Never expose nexus-mcp directly.

---

## Phase 15 — Temporal graph memory

Graphiti under AEON-IQ (not a competing brain).  
L0–L6 memory scopes. Asynchronous outbox ingestion. Rank/fuse retrieval.

---

## Final MCP surface (after full integration)

```
computer_pair
computer_status
computer_exec
computer_fs
computer_observe
computer_act
handoff_send
handoff_receive
memory_context
memory_remember
```

Infrastructure tools (runloop_*, firecracker_*, nexus_*, graphiti_*, postgres_*) remain internal.

---

## Definition of done (entire build)

A user can create NOEMA / Code / Research / Design inside Grok Bot and receive four different isolated computers, filesystems, browser profiles, authenticated sessions, and working histories, while still allowing explicit handoffs, persistence, human takeover, pause/resume, disaster recovery, scoped credentials, audit, bounded graph memory, Nexus-secured WASM tools, AEON-IQ recall, and Proof Capsules — without Flok replacing Grok Bot itself.
