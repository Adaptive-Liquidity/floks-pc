# floks-pc

**FLOKS Agent Computer Cloud — every bot gets its own isolated computer.**

An Agent Computer is a provider-backed machine assigned to exactly one Grok Bot through pair-code onboarding and scoped capability tokens. **Runloop Devbox is provider v1** (backend infrastructure, not the product name).

This package is the standalone TypeScript runtime for that product: MCP gateway, pairing, capability auth, ComputerService, and the Runloop provider. It is deliberately separate from the main Flok application.

Launch sequence is **L0–L9** in `PHASES.md` (fastest path to a usable bot computer, then upgrades). Historical engineering gates C0–C6 and landed C7 are the evidence record. Nexus-IQ stays locked until Gate G0.

## Isolation rule (non-negotiable)

> **This package must never write to, import runtime code from, or modify the main Flok application repository.**

All computer domain logic, providers, migrations, worker, and MCP surface live here. After Gate G0 this package can be published or consumed by Flok as a dependency / monorepo workspace.

## Current status

Product object: **Agent Computer**. Backend v1: **Runloop Devbox**. Open work: **L2 Live Node Console**.

| Launch | Status |
|--------|--------|
| **L0** — C7 landing / CDP AX proof | **CLOSED / PASSED** — [PR #17](https://github.com/Adaptive-Liquidity/floks-pc/pull/17) (`bda72e0`). Live Grok Bot `computer_observe({ include_accessibility: true })` → `accessibility_summary.source === "cdp"` with real nodes. FakeProvider is not proof. |
| **L1** — Launch MVP: one bot, one Agent Computer | **CLOSED / PASSED** — [PR #21](https://github.com/Adaptive-Liquidity/floks-pc/pull/21) (`61c9747`). Remote Grok Bot over authenticated HTTPS; live Runloop pair/status/observe `source=cdp` + fs; this-run destroy. |
| **L2** — Bot Computers / Live Node Console | **OPEN** — operator console at `/console` (same process as MCP). Not an MCP tool. |
| **L3** — Private beta | After L2. **Safety caps only:** invite/approval, visible cost warning, max active machines per beta user, default auto-shutdown. Real quotas/billing are **L7**. |
| **L4–L9** — recovery, safer click, handoffs, **L7 quotas/billing**, provider fabric, enterprise | After users can join. See `PHASES.md` and `docs/computers/agent-computer-cloud.md`. |

Historical C0–C6 (scaffold → pairing → MCP → shell/fs) are **CLOSED**. `click_element` stays fail-closed until **L5**. Takeover, snapshots, and extra MCP tools are not launch. Nexus-IQ remains hard-locked until Gate G0.

## Authority files (read in this order)

1. `AGENTS.md` — isolation fence + phase enforcement for every coding agent
2. `AUTHORITY.md` — local product & architecture contract
3. `PHASES.md` — launch sequence L0–L9 (current open: L2) plus historical C0–C6 / G0 lock
4. `docs/computers/agent-computer-cloud.md` — product object, feature matrix, what not to claim
5. `docs/computers/` — architecture, MCP, security, provider contract

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

Loopback MCP (FakeProvider, not public, not paid, **not** Agent Computer proof). Same process serves the L2 operator console on a **separate loopback port** at `http://127.0.0.1:8788/console`:

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 npm run start:mcp
```

Real Agent Computer (paid Runloop; owner-approved only). **L1 must fail before accepting the computer** unless `FLOK_RUNLOOP_BLUEPRINT` is `flok-runloop-interactive` (or an equivalent validated interactive stack). Generic DnD Ubuntu is compute-only and is **not** an Agent Computer.

**A. Local/operator smoke** (`127.0.0.1`, default). Remote Grok Bot cannot connect:

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_MCP_PROVIDER=runloop \
FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive \
FLOK_MCP_LISTEN_HOST=127.0.0.1 \
FLOK_MCP_BOOTSTRAP=1 \
FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local \
FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local \
npm run start:mcp
```

**B. Remote Grok Bot** needs an operator **authenticated HTTPS** tunnel/proxy in front of MCP, plus `FLOK_MCP_AUTH_TOKEN`. Do not expose unauthenticated public MCP. **127.0.0.1 is not a real remote Grok Bot endpoint. A remote Grok Bot needs an authenticated HTTPS endpoint that forwards to the MCP server and requires FLOK_MCP_AUTH_TOKEN.** Runbook: `docs/computers/REMOTE_GROK_MCP.md`.

**MCP cannot destroy the Devbox. `Ctrl+C` does not destroy it.** Only shut down the Devbox created by this FLOKS run. Never bulk-shutdown all Devboxes returned by the Runloop account. Prefer the captured `providerRef` from this run; if unsure, do not shut down anything.

```bash
FLOK_MCP_PROVIDER=runloop \
FLOK_CONTROL_PLANE_PATH=.flok/control-plane.json \
FLOK_DESTROY_CONFIRM=1 \
FLOK_DESTROY_PROVIDER_REF="<captured-providerRef-from-this-run>" \
npm run computers:destroy-run
```

Full runbook: `docs/computers/agent-computer-cloud.md`. Runloop MCP persists records to `FLOK_CONTROL_PLANE_PATH` (default `.flok/control-plane.json`) so a restart does not forget active machines.

```bash
# Placeholder id only — use the captured providerRef from THIS run.
curl -sS -X POST -H "Authorization: Bearer ${RUNLOOP_API_KEY}" \
  "https://api.runloop.ai/v1/devboxes/dbx_REDACTED/shutdown"
```

Never log or paste the API key or real provider IDs. Keep-alive is a timeout fallback, not cleanup. Do not run paid Runloop in required PR CI.

Local FakeProvider bootstrap (optional; prints a one-time pair code to stdout, 10 min TTL):

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_MCP_BOOTSTRAP=1 \
FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local \
FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local \
FLOK_MCP_LISTEN_PORT=8790 \
npm run start:mcp
```

`computer_pair` must use those exact `bird_id` / `flock_id` values (defaults are `bird-local` / `flock-local` if the env vars are omitted). In-process re-bootstrap reissues a pair code and burns the unused previous code; a process restart creates a new in-memory computer. Binding `0.0.0.0` / `::` requires `FLOK_MCP_AUTH_TOKEN` (connection auth only — never a capability). Do not enable `FLOK_MCP_BOOTSTRAP` under systemd/Docker/CI: the one-time pair code is printed to stdout and will land in captured logs.

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

Private development under Adaptive Liquidity Labs. Public repository for collaboration on FLOKS Agent Computer Cloud.

Do not claim residential proxies, bot-detection bypass, full root / uncensored terminal, or production-ready security. `click_element` is fail-closed. MCP cannot destroy a Devbox; `Ctrl+C` does not either. MCP fs write-ok / read-empty is a known L1 bug.
