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
| **C3A** — Runloop Devbox compute substrate | **CLOSED / PASSED** |
| **C3B** — interactive computer (display, browser, screenshot, bounded input) | **CLOSED / PASSED** |
| **C4** — pair codes + capability tokens (internal layer) | **CLOSED / PASSED** |
| **C5** — Flok MCP Gateway (`POST /mcp`, eight tools) | **IMPLEMENTED + hardening merged on main** (unpaid FakeProvider tests; real Grok Bot / public URL remains manual) |
| **C6** — Shell + filesystem (argv, path jail, limits) | **CLOSED / PASSED** (unpaid FakeProvider + MCP; real Grok Bot / public HTTPS remains manual). C7 not started. |
| C7+ | Not started (Nexus-IQ remains hard-locked until G0) |

## Authority files (read in this order)

1. `AGENTS.md` — isolation fence + phase enforcement for every coding agent
2. `AUTHORITY.md` — local product & architecture contract
3. `PHASES.md` — full C0 → G0 → 15 sequence with gates
4. `docs/computers/` — architecture, security, provider contract

## Hard locks

- `FLOK_NEXUS_IQ_ENABLED=false` until Gate G0 passes
- `FLOK_GRAPH_MEMORY_ENABLED=false` until after Nexus core
- Production isolation boundary is a **VM** (Runloop Devboxes → later Kata/Firecracker), never a shared-kernel container

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

Live Runloop tests (paid Devboxes) skip unless `FLOK_LIVE_RUNLOOP_TEST=1`. They require `RUNLOOP_API_KEY` and `FLOK_RUNLOOP_BLUEPRINT` (default `runloop/universal-ubuntu-24.04-x86_64-dnd`):

```bash
FLOK_LIVE_RUNLOOP_TEST=1 npm run test:live:runloop
```

When the flag is set, missing credentials **fail** the suite. Live Runloop is **not** part of `npm run verify` or required PR CI.

Loopback MCP (FakeProvider, not public, not paid):

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 npm run start:mcp
```

See `docs/computers/MCP.md`. Real Grok Bot pairing needs an approved public HTTPS `POST /mcp` URL; this package does not deploy one.

C3B interactive live tests are a separate manual workflow (`runloop-c3` phase `c3b-live` only; do not add standalone `runloop-c3b.yml` or `runloop-blueprint.yml`). They need the custom interactive Blueprint (built from the DnD base; not bare Ubuntu) and `FLOK_LIVE_RUNLOOP_C3B_TEST=1`. Paid live gate **passed** on run `32559415086` (SHA `b892978`). `computerUse` is **true**. `accessibility` / `vnc` / `pauseMemory` stay **false**.

Store production credentials in GitHub Actions only (never in git, `.env` committed to the repo, or a Node VM / Devbox):

| Name | Where | Purpose |
|------|--------|---------|
| `RUNLOOP_API_KEY` | Repository **secret** | Runloop control-plane API key |
| `FLOK_RUNLOOP_BLUEPRINT` | Repository **variable or secret** | C3A generic Ubuntu Blueprint name |
| `FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT` | Repository **variable or secret** | C3B interactive Blueprint name (after `bash blueprints/runloop-interactive/build.sh`) |

GitHub **Variables** and **Secrets** are different stores. A value saved only as a Secret is not visible as `vars.FLOK_*`. Workflows accept either.

```text
PR  (GitHub Actions runs these; the ruleset only blocks merge until they are green)
├─ verify        ← typecheck + tests + build (every PR, free)
├─ docker-c2     ← Docker isolation test (GitHub-hosted Docker)
├─ merge-gate    ← security/policy scripts + classification replies
└─ runloop-c3    ← manual workflow_dispatch only (not a required check)
```

GitHub, not Cursor, enforces merge to `main`. See `.github/MERGE_GATE.md`. Apply the JSON ruleset with `GH_ADMIN_TOKEN=... npm run protect:main` (Administration permission). Do not require paid Runloop jobs.

Run C3A from Actions → **runloop-c3** → Run workflow. Do not use `runloopai/deploy-agent`. Do not make paid jobs required status checks. Never log the API key or its length.

Do **not** enable Nexus, AEON, or Graphiti until Gate G0 is marked PASSED in `PHASES.md`.

## How to inspect Flok stack conventions

See `reference/flok-core/`. That take-pack contains curated, read-only excerpts of terminology, AGENTS rules, Kysely/db patterns, ID conventions, and migration style. Use them for consistency only — never import executable code from the main Flok repo.

## License / ownership

Private development under Adaptive Liquidity Labs. Public repository for collaboration on the Flok Computer addon.
