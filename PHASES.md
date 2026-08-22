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

### Gate C3B — interactive computer  ← CURRENT / OPEN

**Goal:** Browser + private display + screenshot + bounded input + persistent profile inside each Runloop Devbox. Grok remains the intelligence. Runloop remains the computer.

### Implement
- Reproducible interactive Blueprint under `blueprints/runloop-interactive/`
- Persistent profile `/home/user/flok/.browser/profile`
- `ensureInteractiveStack()` after provision and resume (disk survives suspend; RAM/processes do not)
- `observe()` screenshot from `:99`
- Bounded `act()`: click_coordinates, type, key, scroll, open_url, wait; `click_element` fail-closed
- Local noVNC on localhost only; `takeover()` remains fail-closed; `vnc: false`
- `computerUse: true` only after unpaid tests prove the contract
- Manual `runloop-c3b` workflow; **do not run paid live tests until approved**

### Non-goals (do not invent)
- Browserbase, Kernel, Runloop Agents, MCP, pairing, Grok Bot connection, Nexus/AEON/Graphiti
- Public VNC URL
- `mode: "shell"`
- Chromium `--no-sandbox` unless a verified Runloop incompatibility is documented

**Status:** OPEN

---

## Phase 4 — Node pairing and capability security

**Goal:** Pair codes + capability tokens. MCP auth alone cannot identify a Bot.

### Gate C4
Valid NOEMA capability cannot access Code’s machine even when both Bots share the same account-level MCP connection.

---

## Phase 5 — Flok MCP Gateway

**Goal:** Single `POST /mcp` endpoint, Streamable HTTP, 2026-07-28 preferred, eight tools only.

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

### Gate C5
Real Grok Bot can pair → status → exec → read/write file through the public endpoint.

---

## Phase 6 — Shell and filesystem

**Goal:** Useful machine before GUI. argv[] preferred, path jail, max runtime/output.

### Gate C6
Grok Bot completes a real coding exercise entirely on its Flok Computer (clone → edit → install → test → artifact).

---

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
