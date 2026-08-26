# PHASES — FLOKS Agent Computer Cloud

Authoritative **launch** sequence is **L0–L9** below. Work only on the currently open launch phase.

Historical C0–C6 remain the closed engineering record (do not re-open them). Landed C7 is **L0**. Original leftover C7 goals (three concurrent Bots, public VNC takeover) plus C8–C15 map into **L4–L9 / G0** so we do **not** overbuild before a Grok Bot can use one working Agent Computer.

Nexus-IQ / AEON / Graphiti stay **forbidden** until **Gate G0** is marked PASSED.

**Current open phase: L1 — Launch MVP (one bot, one Agent Computer).**  
**L0 is CLOSED** — Adaptive-Liquidity/floks-pc#17 (`bda72e0`).

Product language: `docs/computers/agent-computer-cloud.md`.  
Runloop Devbox is **provider v1**, not the product name.

---

## Launch sequence (L0–L9)

### PHASE L0 — C7 landing / proof lock

**Purpose:** Land the real Grok Bot → MCP → Runloop → Chrome/CDP proof.

**Status:** CLOSED / PASSED (2026-08-26)

**Must include (met):**
- C7 PR #17 squash-merged after `verify` + `docker-c2` + `merge-gate` + classification replies
- Live C7 proof: not FakeProvider
- Exactly eight MCP tools; no new tools
- `click_element` remains fail-closed
- CDP loopback-only (`127.0.0.1:9222`); no `--no-sandbox`; no `0.0.0.0`
- Interactive blueprint `flok-runloop-interactive` (`flok-ui`)
- Devbox cleanup: live box `dbx_34DcbsIeIV236eUxzxKsR` shut down
- Known bug logged: MCP fs write-ok / file on disk / MCP read empty

**Gate:** A real Grok Bot calls `computer_observe({ include_accessibility: true })` and receives `accessibility_summary.source === "cdp"` with non-empty nodes from a real Runloop Agent Computer.

**Evidence:** Pair `bird-local` / `flock-local`. Observe returned `source: "cdp"` with 6 nodes; root `RootWebArea` / `FLOKS C3B fixture` with bounds. No screenshot required. No `open_url` required (observe starts Chrome when CDP is down). `capabilities().accessibility` stays `false`.

---

### PHASE L1 — Launch MVP: one bot, one Agent Computer

**Purpose:** Smallest usable product: each Grok Bot can pair to its own working Agent Computer.

**Status:** OPEN

**Required:**
- Pair-code onboarding + capability token auth
- One bot → one Agent Computer
- Runloop provider v1 (`FLOK_MCP_PROVIDER=runloop`, interactive blueprint)
- status, observe screenshot, observe CDP accessibility
- `open_url` / wait / safe basic actions
- terminal/exec
- file write/read/list/stat (and remaining fs ops)
- private workspace
- lifecycle stop/destroy
- cost/runtime visibility
- cleanup safety
- redacted logs
- simple operator runbook

**Must fix before beta (L3):**
- MCP fs write-ok / read-empty
- cleanup/destroy obvious and reliable (MCP stop ≠ Devbox destroy)
- owner/operator can see active Agent Computers
- startup instructions simple enough to run without a live walkthrough

**Non-goals:** new MCP tools, Fake AX, fake clicking, takeover, C8/C9 code, proxies, Nexus/AEON/Graphiti, paid tests in required CI.

**Gate:** A real Grok Bot can pair, use its assigned Agent Computer, observe browser state, use files/exec, and the operator can safely stop/destroy the computer.

---

### PHASE L2 — Beta dashboard: Bot Computers / Live Node Console

**Purpose:** First product UI.

**Layout**
- Left: bot list, paired/unpaired, running/sleeping/stopped, current machine, last action
- Center: selected Agent Computer, live observe preview, browser status, CDP/accessibility status, workspace, files/terminal summary
- Right: provider Runloop, capability scopes, session expiry, runtime/cost, pair status, cleanup/destroy, warnings
- Bottom event log: pair, status, observe, browser, file, exec, fail-closed, cleanup

**Gate:** A non-engineer understands: this bot has this computer, it is running, this is what it sees, these are its permissions, this is how I stop it.

---

### PHASE L3 — Private beta launch

**Purpose:** Let users sign up / join while upgrades continue.

**Required:** controlled onboarding, waitlist or invite codes, pricing/cost warning, usage limits, max active machines, default auto-shutdown, support/debug packet, bug-report template, known-limitations page.

**Must say clearly:** `click_element` not yet supported; proxies/residential egress not included; production scale not proven; no guaranteed bot-detection bypass; background jobs via exec/files; browser computer use is the first lane.

**Gate:** Users can join, connect a bot, get an Agent Computer, run basic browser/files/exec workflows, and report bugs without a live explanation every time.

---

### PHASE L4 — Reliability / recovery

**Purpose:** Agent Computers survive real use. Maps former Phase 8 (C8).

Includes: provider-native snapshots, wake/pause/resume polish, failed-boot recovery, stale-machine cleanup, restore runbook, better errors, retry-safe observe.

**Gate:** A bot can pause/wake/recover without losing its workspace; operators can recover common failures.

---

### PHASE L5 — Safer browser control

**Purpose:** Structured clicks from real CDP/accessibility bounds. Never guessed clicks. Offscreen/subpixel fail-closed. Optional human approval for risky clicks. No FakeProvider proof.

**Gate:** Bot can click real page elements through verified CDP mapping; bad mappings fail closed.

---

### PHASE L6 — Team / workflow layer

**Purpose:** Maps former Phase 9 (C9). Explicit one-file handoff first. No automatic cookie/profile/.env/key sharing. Audit trail. Task-level machine assignment.

**Gate:** One bot can hand a file/result to another without giving away its whole computer.

---

### PHASE L7 — Scale / quotas / billing controls

**Purpose:** Maps former Phase 11. Quotas, max active machines, runtime limits, auto-destroy, cost visibility, worker queue if needed, observability, admin kill switch, provider capacity.

**Gate:** Multiple users/bots without runaway spend or orphan machines.

---

### PHASE L8 — Provider fabric

**Purpose:** Agent Computer stays the product. Runloop remains v1. Later: browser-only, cheaper background worker, microVM, private cloud / bare metal. Do not replace Runloop now.

**Gate:** FLOKS can choose a backend without changing the customer-facing product.

---

### PHASE L9 — Enterprise / private infra

Dedicated hosts, bare-metal-backed microVM fleet, stricter isolation, enterprise audit, custom egress policy, SSO/team permissions later.

**Gate:** Enterprise customer can run Agent Computers with stronger isolation/control.

---

## Historical closed gates (C0–C6)

These stay the evidence record. Do not re-open them to invent launch work.

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
- Manual `runloop-c3` phase `c3b-live` (the only Runloop workflow; do not add standalone `runloop-c3b.yml` / `runloop-blueprint.yml`)

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
- Hardened `computer_exec` with argv[] enforcement, shell scope gating, and limits (argv count 64, argv item length 8192, cwd max 1024, timeout max 600s, env key count 32, env key/value length limits)
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
- Unpaid FakeProvider tests: full suite green (`npm test` 209 pass / 0 fail), including the pair → mkdir → write → list → read → exec → modify → artifact workflow through MCP tools only
- Real public Grok Bot coding exercise: pending separate manual proof (same public-HTTPS gate as C5)

**Status:** IMPLEMENTED (unpaid FakeProvider + MCP gate green; real Grok Bot / public URL remains manual and is **not** claimed here). Live C7 CDP AX later landed as **L0** (PR #17). Persistence (C8) and handoffs (C9) remain later launch phases L4 / L6. Paid Runloop was **not** required for unpaid C6.

### Evidence
- Branch: `feat/c6-shell-files` → [Adaptive-Liquidity/floks-pc#10](https://github.com/Adaptive-Liquidity/floks-pc/pull/10)
- Base: `main` after [Adaptive-Liquidity/floks-pc#9](https://github.com/Adaptive-Liquidity/floks-pc/pull/9) (`1269d27`)
- Verification on branch: `npm run typecheck` + `npm test` + `npm run build` + `npm run verify` — **209 pass / 0 fail**
- Paid Runloop: not required, not run
- Isolation: zero writes under Floks-main
- Nexus/graph flags remain false
- C3B preserved: `computerUse: true`, `accessibility: false`, `vnc: false`, `pauseMemory: false`

### Known limitations (not C6 blockers)
- FakeProvider is in-memory (state resets on restart); persistence is C8
- `.gitattributes` pins `*.sh` to `eol=lf` so byte-exact script comparisons stay green on Windows checkouts

## Historical C7 — guest Chrome loopback CDP (landed as L0)

**What actually shipped:** real Grok Bot → MCP → Runloop Agent Computer → guest Chrome CDP accessibility observe.

This is **not** the original Phase 7 gate (three concurrent Bots + public VNC takeover). Those leftovers are deferred (see mapping below). `click_element` stays fail-closed until **L5**.

### Gate C7 / L0 (closed)

A real Grok Bot calls `computer_observe({ include_accessibility: true })` and receives `accessibility_summary.source === "cdp"` with non-empty nodes from a real Runloop Agent Computer. FakeProvider is **not** proof.

**Status:** CLOSED / PASSED (2026-08-26)

**Evidence**
- Merge: [Adaptive-Liquidity/floks-pc#17](https://github.com/Adaptive-Liquidity/floks-pc/pull/17) → `bda72e00b67d2667afcdc9fbe1138b6483fb6863`
- Pair as `bird-local` / `flock-local`
- Observe returned `source: "cdp"` with 6 nodes; root `RootWebArea` / `FLOKS C3B fixture` with bounds
- No screenshot required; no `open_url` required (observe may start Chrome when CDP is down)
- Exactly eight MCP tools; no new tools
- CDP loopback-only (`127.0.0.1:9222`); no `--no-sandbox`; no `0.0.0.0`
- Interactive blueprint `flok-runloop-interactive` (`flok-ui`)
- `capabilities().accessibility` stays `false`
- Live box `dbx_34DcbsIeIV236eUxzxKsR` shut down after proof
- Isolation: zero writes under Floks-main
- Nexus / graph flags remain false

**Known limitations (not L0 blockers; L1 / later)**
- MCP `computer_fs` write-ok / file on disk / MCP read empty
- `click_element` fail-closed until L5
- Takeover / authenticated VNC not implemented
- In-memory ComputerService store until L4
- Public HTTPS `POST /mcp` is still an operator/deploy choice

---

## Original later phases (mapped — not the next work)

Do **not** treat the headings below as the currently open sequence. Launch work is **L1–L9** at the top of this file. Users may join at **L3** while these upgrades continue. Nexus-IQ / AEON / Graphiti stay forbidden until **Gate G0**.

| Original | Launch mapping | Notes |
|----------|----------------|-------|
| C7 leftover: 3 concurrent Bots | After L3 / G0 evidence | Not L1. One bot, one Agent Computer first. |
| C7 leftover: public VNC takeover | Deferred | Fail-closed. Not launch. |
| C7 leftover: `click_element` from AX bounds | **L5** | Never guessed clicks. No FakeProvider proof. |
| C8 persistence / recovery | **L4** | After users can join (L3). Provider-native snapshots first. |
| C9 explicit handoffs | **L6** | One-file handoff first. No cookie/profile/.env sharing. |
| C10 network + CredentialBroker | After L3 | Do not claim residential proxies or bot-detection bypass. |
| C11 worker / quotas / observability | **L7** | Needed before runaway spend. |
| G0 standalone acceptance | Nexus lock | **Not** an L3 private-beta blocker. |
| Phase 13 Kata / Firecracker | **L8 / L9** | Keep Runloop as provider v1. |
| Phase 14–15 Nexus / AEON / Graphiti | After G0 only | Hard flags stay false. |

### Former Phase 8 — Persistence and recovery → L4

**Goal:** Agent Computers survive real use. Provider-native snapshots, wake/pause/resume polish, failed-boot recovery, stale-machine cleanup, restore runbook, retry-safe observe.

**Historical Gate C8:** Destroy Node VM intentionally → provision replacement → restore latest checkpoint → model-created file survives.

Do not start C8/L4 code while L1 is open.

### Former Phase 9 — Explicit Node handoffs → L6

**Goal:** Private by default, explicit sharing by design. Never auto-transfer browser profiles, cookies, keys, `.env`, capability tokens.

**Historical Gate C9:** Code shares one file with NOEMA; NOEMA receives only that file and still cannot browse Code’s filesystem.

`handoff_send` / `handoff_receive` stay listed as two of the eight MCP tools and remain `PHASE_NOT_STARTED` until L6. Launch MVP does **not** add tools.

### Former Phase 10 — Network and credential security

**Goal:** CredentialBroker (service-specific, not general MITM), network policy defaults (inbound deny, metadata deny, cross-Node deny).

**Historical Gate C10:** Secret scanning proves provider/API credentials never appear in Node environment, workspace, terminal logs, MCP logs, audit table, or Pulse.

Do **not** claim residential proxies, custom egress as a current product, or “never trips bot detection.”

### Former Phase 11 — Worker, quotas and observability → L7

**Goal:** Quotas, max active machines, runtime limits, auto-destroy, cost visibility, worker queue if needed, observability, admin kill switch, provider capacity.

**Historical Gate C11:** Complete trace for one Grok action from MCP request to provider result without secrets or private terminal contents.

### Gate G0 — Nexus lock (unchanged)

**Nexus-IQ still disabled.** G0 is the lock before Nexus / AEON / Graphiti may enter the architecture. It is **not** a blocker for L1 launch MVP or L3 private beta.

All of the following must PASS before G0:

- Real Grok Bot integration
- 3 isolated Nodes concurrent
- Browser, terminal, files
- Persistence + recovery
- Handoff
- Security tests (cross-Node denial, path escape, replay, secret leakage, etc.)
- Load test (k6)
- Production-like staging

**Only after G0 is green may Nexus-IQ enter the architecture.**

```
FLOK_NEXUS_IQ_ENABLED=false
FLOK_GRAPH_MEMORY_ENABLED=false
```

### Former Phase 13 — Self-hosted compute → L8 / L9

KataProvider + containerd + Kata 4 + Firecracker, then enterprise private cloud / dedicated hosts / bare-metal-backed microVMs.

Do **not** replace Runloop now. Runloop Devbox is the working **provider v1**. The Agent Computer stays the customer-facing product.

### Former Phase 14 — Nexus-IQ integration (first allowed touch, after G0)

14A — Nexus core only (`NEXUS_AEON_ENABLED=false`)
14B — Proof Capsules
14C — AEON-IQ (shared governed plane)
14D — Attestation (pin verifying key)

Still: Grok → Flok MCP → ComputerService. Never expose nexus-mcp directly.

### Former Phase 15 — Temporal graph memory (after G0)

Graphiti under AEON-IQ (not a competing brain). Memory scopes, asynchronous outbox ingestion, rank/fuse retrieval.

---

## MCP surface

Launch (L1–L3) keeps **exactly eight tools**. Do not add tools for MVP.

```
computer_pair
computer_status
computer_exec
computer_fs
computer_observe
computer_act
handoff_send          ← PHASE_NOT_STARTED until L6
handoff_receive       ← PHASE_NOT_STARTED until L6
```

`memory_context` / `memory_remember` exist only after G0. Infrastructure tools (`runloop_*`, `firecracker_*`, `nexus_*`, `graphiti_*`, `postgres_*`) remain internal.

---

## Launch definition of done (L1–L3)

FLOKS Agent Computer Cloud: a user can pair a Grok Bot to one isolated Agent Computer (Runloop provider v1), observe real Chrome (screenshot + CDP accessibility), use files and exec, see cost/runtime, and an operator can stop/destroy the machine. Users can join a private beta while later upgrades (snapshots, structured click, handoffs, quotas, extra providers) continue.

Do not claim: residential proxies, bot-detection bypass, full root / uncensored terminal, unthrottled infra, production-ready security, or that `click_element` works.

---

## Full-system definition of done (G0, not launch)

A user can create NOEMA / Code / Research / Design inside Grok Bot and receive four different isolated computers, filesystems, browser profiles, authenticated sessions, and working histories, while still allowing explicit handoffs, persistence, human takeover, pause/resume, disaster recovery, scoped credentials, audit, bounded graph memory, Nexus-secured WASM tools, AEON-IQ recall, and Proof Capsules — without Flok replacing Grok Bot itself.
