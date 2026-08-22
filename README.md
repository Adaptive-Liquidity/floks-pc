# floks-pc

**An addon for Floks so your Grok Bots no longer need to share a computer.**

Isolated Flok Node Computer runtime — per-Node VMs, MCP gateway, pairing, jobs, checkpoints, handoffs, and recovery.

This package implements the complete Flok Computer system (Phases 0–15) as a standalone TypeScript project. It is deliberately separate from the main Flok application so the Computer substrate can be built, tested, and gated independently.

## Isolation rule (non-negotiable)

> **This package must never write to, import runtime code from, or modify the main Flok application repository.**

All computer domain logic, providers, migrations, worker, and MCP surface live here. After Gate G0 this package can be published or consumed by Flok as a dependency / monorepo workspace.

## Current status

| Gate | Status |
|------|--------|
| **C0** — scaffold, authority, domain types, ComputerProvider interface | **CLOSED / PASSED** |
| **C1** — domain logic, FakeProvider, ComputerService, unit tests | **CLOSED / PASSED** |
| **C2** — DockerDevProvider + isolation/persistence | **CLOSED / PASSED** |
| **C3** — Daytona Linux VM provider | CURRENT |
| C4+ | Not started (Nexus-IQ remains hard-locked until G0) |

## Authority files (read in this order)

1. `AGENTS.md` — isolation fence + phase enforcement for every coding agent
2. `AUTHORITY.md` — local product & architecture contract
3. `PHASES.md` — full C0 → G0 → 15 sequence with gates
4. `docs/computers/` — architecture, security, provider contract

## Hard locks

- `FLOK_NEXUS_IQ_ENABLED=false` until Gate G0 passes
- `FLOK_GRAPH_MEMORY_ENABLED=false` until after Nexus core
- Production isolation boundary is a **VM** (Daytona Linux VM → later Kata/Firecracker), never a shared-kernel container

## Quick start

```bash
# Requires Node >= 22.12 < 23
npm ci
npm run verify        # typecheck + non-paid tests + build
```

Live Docker isolation tests skip unless `FLOK_LIVE_DOCKER_TEST=1`. On a Docker host (including the `docker-c2` GitHub Actions job) run:

```bash
bash ./infra/docker/build.sh
FLOK_LIVE_DOCKER_TEST=1 npm run test:live:docker
```

When the flag is set, Docker unavailability **fails** the suite; it never silent-skips. These live tests are **not** part of `npm run verify`.

Live Daytona tests (paid Linux VMs) skip unless `FLOK_LIVE_DAYTONA_TEST=1`. They require `DAYTONA_API_KEY` and `FLOK_DAYTONA_SNAPSHOT` (a **Linux VM** snapshot, not the default container class):

```bash
FLOK_LIVE_DAYTONA_TEST=1 npm run test:live:daytona
```

When the flag is set, missing credentials **fail** the suite. Live Daytona is **not** part of `npm run verify` or required PR CI.

Store production credentials in GitHub Actions only (never in git, `.env` committed to the repo, or a Node VM):

| Name | Where | Purpose |
|------|--------|---------|
| `DAYTONA_API_KEY` | Repository **secret** | Daytona control-plane API key |
| `FLOK_DAYTONA_SNAPSHOT` | Repository **variable** | Linux VM snapshot name (e.g. `daytona-vm-medium`) |

```text
PR
├─ verify        ← every PR (free)
├─ docker-c2     ← every PR (GitHub-hosted Docker)
└─ daytona-live  ← manual workflow_dispatch only
       ├─ secrets.DAYTONA_API_KEY
       └─ vars.FLOK_DAYTONA_SNAPSHOT
```

Run it from Actions → **daytona-c3** → Run workflow. Do not make it a required status check. You do not need `DAYTONA_API_URL` unless you use a nonstandard endpoint.

Do **not** enable Nexus, AEON, or Graphiti until Gate G0 is marked PASSED in `PHASES.md`.

## How to inspect Flok stack conventions

See `reference/flok-core/`. That take-pack contains curated, read-only excerpts of terminology, AGENTS rules, Kysely/db patterns, ID conventions, and migration style. Use them for consistency only — never import executable code from the main Flok repo.

## License / ownership

Private development under Adaptive Liquidity Labs. Public repository for collaboration on the Flok Computer addon.
