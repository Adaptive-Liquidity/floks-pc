# Architecture — Agent Computer

Product: **FLOKS Agent Computer Cloud**. One bot, one isolated Agent Computer. See `docs/computers/agent-computer-cloud.md`.

Runloop Devbox is **provider v1** (backend). Fake/DockerDev are test/dev. Kata / extra providers are **L8/L9**, not launch.

## Separation of concerns

```
Grok Bot (intelligence, skills, routines, conversation)
        │
        │  Remote MCP / HTTPS
        ▼
FLOKS Agent Computer Cloud (this package)
  ├─ Identity & pairing
  ├─ Capability tokens (digests only)
  ├─ Job queue (Postgres outbox + LISTEN/NOTIFY) — L7
  ├─ ComputerService (orchestration)
  ├─ ComputerProvider interface
  │     ├─ FakeProvider          (unit / contract tests; not C7/L0 proof)
  │     ├─ DockerDevProvider     (local integration only)
  │     ├─ RunloopProvider       (provider v1 — Agent Computer backend)
  │     │     filesystem, terminal, private display, in-guest Chrome, loopback CDP
  │     └─ KataProvider          (self-host, L8/L9)
  ├─ MCP Gateway (exactly eight tools)
  ├─ Checkpoints → provider-native snapshots (L4); tar+zstd object storage is a future archive format
  └─ Audit metadata (no private content by default)
```

## Why a separate package

The main Flok application (`Floks-main`) remains the public Flok product surface (Roosts, Tape, Grade, Contracts, etc.).  
This runtime owns **Agent Computers**. After Gate G0 it can be imported by Flok without the two codebases having been entangled during development. L1–L3 launch does not wait on that mount.

## Control plane vs compute plane

- **Control plane** (this package): pairing, capabilities, jobs, policies, audit, MCP endpoint.
- **Compute plane**: one VM (or later microVM) per Node — the Agent Computer. Filesystem, processes, browser, and the private display live only there. C3B extends `runloop/universal-ubuntu-24.04-x86_64-dnd` so Docker/Node/Python/Git stay available; Chrome and the X stack run as `flok-ui`, not root. Grok remains the intelligence; Runloop is the computer backend, not the agent runtime. Do not call this “containerized” in customer copy: v1 isolation is VM-backed.

No route or MCP tool may call a concrete provider. Everything goes through `ComputerService` → `ComputerProvider`. The C5 public surface is `POST /mcp` (`docs/computers/MCP.md`).

## Data ownership

All `computer_*` tables live in this package’s own Postgres / PGLite instance.  
`bird_id` and `flock_id` are opaque strings. Hard foreign keys to Flok’s `birds` table appear only at integration time.

## Persistence model

```
immutable base image
+ portable /home/flok workspace
+ checkpoint manifest (sha256, revision, base_image, size)
```

L4 checkpoints are provider-native snapshots. `tar + zstd` in object storage is a future/archive format, not the current implementation. Browser profiles stay Node-private and encrypted; they are never included in handoffs.

## Recovery path

```
provider machine unavailable
  → mark recovering
  → restore latest checkpoint onto a replacement
  → health probe
  → destroy original VM with the captured providerRef only
  → ready
```

## Security boundary

Production isolation is a **VM** (Runloop Devboxes, later Kata + Firecracker).  
Ordinary containers share the host kernel and are not the production security architecture. Docker is useful for local testing and for optional tool containers *inside* a Node, not as the Node boundary itself.

## Launch vs later

- **L1** uses the existing eight MCP tools, Runloop provider v1, and fail-closed `click_element`.
- Dashboard is **L2**. Private beta signup is **L3**. Snapshots/recovery **L4**. Safer clicks **L5**. Handoffs **L6**. Quotas/worker **L7**. Extra providers **L8**. Enterprise **L9**.
- L4 checkpoints are **provider-native snapshots** (Runloop `snapshotDisk` / Fake in-memory FS clone). `tar + zstd` object storage remains the future/archive format, not this PR.
- Recovery path: mark recovering → restore latest checkpoint onto a replacement → health probe → destroy original VM with the captured providerRef only → ready. No ready or restored checkpoint → fail closed.
- Kata and the job queue in the diagram above remain later architecture.

## Nexus-IQ (Phase 14+, after G0)

Only after Gate G0.  
Nexus is a WASM/WASI execution kernel; it does **not** secure arbitrary Linux shell or browser activity.  
Execution mode becomes `native` or `nexus` per operation. Proof Capsules attach to audit events.

## Memory plane (Phase 14C / 15)

Shared, governed AEON-IQ plane scoped by `user_id / flock_id / node_id / project_id`.  
Graphiti sits under AEON-IQ as a temporal graph index, never as a competing brain exposed directly to Grok.
