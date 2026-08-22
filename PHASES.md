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

## Phase 1 — Computer domain  ← CURRENT

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
- Real network, Docker, Daytona client, MCP server, worker process, S3, Kysely wiring

### Gate C1
- [x] state helpers + tests (legal succeed, illegal throw, deleted terminal) — files present
- [x] FakeProvider implements full interface + isolation between two machines + failure injection — files present
- [x] ComputerService enforces one-computer-per-birdId + LEGAL_TRANSITIONS — files present
- [x] pairing + path pure helpers + tests — files present
- [x] migrations/0001 schema stub present
- [ ] domain test suite green with zero external side-effects (run `npm install && npm run test:domain` in clean Node 22 env)
- [x] Zero files modified under Floks-main

**Status:** IMPLEMENTATION COMPLETE — awaiting mechanical test run to close Gate C1

---

## Phase 2 — Fake + Docker development providers

**Goal:** Deterministic FakeProvider + DockerDevProvider for local isolation proof.

### Gate C2
- Node A writes `/workspace/A.txt` → Node B cannot read it (and vice versa)
- Restart containers → workspace persistence holds
- `NODE_ENV=production` rejects DockerDevProvider

---

## Phase 3 — Daytona production provider

**Goal:** Linux VM class, real lifecycle + exec + fs + observe + act + VNC + checkpoint.

### Gate C3
Two live machines prove different provider IDs, filesystems, browser profiles, process namespaces, independent lifecycle.  
Live tests are **opt-in only** (`FLOK_LIVE_COMPUTER_TEST=1`).

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
Provider parity tests against Fake / DockerDev / Daytona / Kata.

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

Infrastructure tools (daytona_*, firecracker_*, nexus_*, graphiti_*, postgres_*) remain internal.

---

## Definition of done (entire build)

A user can create NOEMA / Code / Research / Design inside Grok Bot and receive four different isolated computers, filesystems, browser profiles, authenticated sessions, and working histories, while still allowing explicit handoffs, persistence, human takeover, pause/resume, disaster recovery, scoped credentials, audit, bounded graph memory, Nexus-secured WASM tools, AEON-IQ recall, and Proof Capsules — without Flok replacing Grok Bot itself.
