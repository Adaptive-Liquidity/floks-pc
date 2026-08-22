# Architecture — Flok Node Computer

## Separation of concerns

```
Grok Bot (intelligence, skills, routines, conversation)
        │
        │  Remote MCP / HTTPS
        ▼
Flok Node Runtime (this package)
  ├─ Identity & pairing
  ├─ Capability tokens (digests only)
  ├─ Job queue (Postgres outbox + LISTEN/NOTIFY)
  ├─ ComputerService (orchestration)
  ├─ ComputerProvider interface
  │     ├─ FakeProvider          (unit / contract tests)
  │     ├─ DockerDevProvider     (local integration only)
  │     ├─ DaytonaProvider       (production v1 — Linux VM)
  │     └─ KataProvider          (self-host, Phase 13)
  ├─ MCP Gateway (eight tools)
  ├─ Checkpoints → S3-compatible object storage
  └─ Audit metadata (no private content by default)
```

## Why a separate package

The main Flok application (`Floks-main`) remains the public product surface (Roosts, Tape, Grade, Contracts, etc.).  
This runtime owns the isolated-computer substrate. After Gate G0 it can be imported by Flok without the two codebases having been entangled during development.

## Control plane vs compute plane

- **Control plane** (this package): pairing, capabilities, jobs, policies, audit, MCP endpoint.
- **Compute plane**: one VM (or later microVM) per Node. Filesystem, processes, browser, VNC live only there.

No route or MCP tool may call a concrete provider. Everything goes through `ComputerService` → `ComputerProvider`.

## Data ownership

All `computer_*` tables live in this package’s own Postgres / PGLite instance.  
`bird_id` and `flock_id` are opaque strings. Hard foreign keys to Flok’s `birds` table appear only at integration time.

## Persistence model

```
immutable base image
+ portable /home/flok workspace
+ checkpoint manifest (sha256, revision, base_image, size)
```

Checkpoints are stored as `tar + zstd` in object storage. Browser profiles stay Node-private and encrypted; they are never included in handoffs.

## Recovery path

```
provider machine unavailable
  → mark recovering
  → provision replacement
  → restore latest checkpoint
  → health probe
  → ready
```

## Security boundary

Production isolation is a **VM** (Daytona Linux VM class, later Kata + Firecracker).  
Ordinary containers share the host kernel and are not the production security architecture. Docker is useful for local testing and for optional tool containers *inside* a Node, not as the Node boundary itself.

## Nexus-IQ (Phase 14+)

Only after Gate G0.  
Nexus is a WASM/WASI execution kernel; it does **not** secure arbitrary Linux shell or browser activity.  
Execution mode becomes `native` or `nexus` per operation. Proof Capsules attach to audit events.

## Memory plane (Phase 14C / 15)

Shared, governed AEON-IQ plane scoped by `user_id / flock_id / node_id / project_id`.  
Graphiti sits under AEON-IQ as a temporal graph index, never as a competing brain exposed directly to Grok.
