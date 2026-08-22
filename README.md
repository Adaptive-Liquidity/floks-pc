# floks-pc

**An addon for Floks so your Grok Bots no longer need to share a computer.**

Isolated Flok Node Computer runtime — per-Node VMs, MCP gateway, pairing, jobs, checkpoints, handoffs, and recovery.

This package implements the complete Flok Computer system (Phases 0–15) as a standalone TypeScript project. It is deliberately separate from the main Flok application so the Computer substrate can be built, tested, and gated independently.

## Isolation rule (non-negotiable)

> **This package must never write to, import runtime code from, or modify the main Flok application repository.**

All computer domain logic, providers, migrations, worker, and MCP surface live here. After Gate G0 (full standalone acceptance) this package can be published or consumed by Flok as a dependency / monorepo workspace.

## Current status

| Gate | Status |
|------|--------|
| **C0** — scaffold, authority, domain types, ComputerProvider interface | **CLOSED / PASSED** |
| **C1** — domain logic, FakeProvider, ComputerService, unit tests | **CLOSED / PASSED** |
| **C2** — DockerDevProvider + isolation/persistence | CURRENT |
| C3+ | Not started (Nexus-IQ remains hard-locked until G0) |

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

Live Docker isolation tests are opt-in (`FLOK_LIVE_DOCKER_TEST=1` / `npm run test:live`) and are **not** part of `verify` or required CI.

Do **not** enable Nexus, AEON, or Graphiti until Gate G0 is marked PASSED in `PHASES.md`.

## How to inspect Flok stack conventions

See `reference/flok-core/`. That take-pack contains curated, read-only excerpts of terminology, AGENTS rules, Kysely/db patterns, ID conventions, and migration style. Use them for consistency only — never import executable code from the main Flok repo.

## License / ownership

Private development under Adaptive Liquidity Labs. Public repository for collaboration on the Flok Computer addon.
