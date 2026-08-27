# flok-node-runtime — Agent Instructions

**This file is authoritative for every coding session inside this repository.**

## ZERO-WRITE RULE (stop-the-line)

Any path under `/home/workdir/artifacts/Floks-main/` is **READ-ONLY**.

- Do not edit, create, delete, rename, or migrate files there.
- Do not run `git add` / `git commit` against that tree.
- Do not import runtime modules from Floks-main (reference/flok-core is copy-only).
- If a task appears to require changing the main Flok app, stop and escalate.

Violations are stop-the-line. Revert immediately.

## Read order

1. Current user instruction
2. This `AGENTS.md`
3. `AUTHORITY.md` — what an Agent Computer is (FLOKS Agent Computer Cloud)
4. `PHASES.md` — current **open** launch phase (L2) + L0–L9 + historical C0–C6 / G0 lock
5. `docs/computers/agent-computer-cloud.md` then `docs/computers/` — product, architecture, MCP, security, provider contract
6. `src/lib/computers/` — domain types and ComputerProvider interface
7. `reference/flok-core/TAKE.md` — curated Flok conventions (read-only)

## Phase enforcement

Work only on the currently open phase listed in `PHASES.md`.

- **Current open phase: L2 — Beta dashboard: Bot Computers / Live Node Console.** L0 / C7 is CLOSED (PR #17). L1 is CLOSED (PR #21, live remote HTTPS + Runloop).
- Historical C0–C6 stay closed. Do not re-open them. Do not start L4+ **workspace snapshots** / L5 click / L6 handoffs / L7 real quotas / extra providers / Nexus while L2 is open. **Durable ComputerRecord / pair / capability / active-machine accounting must exist before L3** (in-memory is local/dev only). L3 later only adds **minimal beta safety caps** (invite, per-user active cap, default auto-shutdown, cost warning) — not L7.
- L2 does **not** add MCP tools (stay at eight). Operator destroy is `/operator/v1` + confirm + captured providerRef for the selected computer, or the CLI runbook. MCP cannot destroy a Devbox. Do not add Fake AX, fake clicking, takeover, C8/C9 code, or proxy/bot-detection claims.
- Paid Agent Computers must use `flok-runloop-interactive` (or equivalent validated interactive stack). Fail before accepting generic compute-only DnD.
- Do not enable or import Nexus-IQ, AEON, Graphiti, or any memory plane until Gate G0 is explicitly marked PASSED. G0 is not an L1–L3 blocker.

## Hard locks (never relax)

```
FLOK_NEXUS_IQ_ENABLED=false
FLOK_GRAPH_MEMORY_ENABLED=false
```

Nexus-IQ work begins only after Gate G0 is marked PASSED. Users may join a private beta at L3 before G0.

## Technology constraints

- Node ≥ 22.12 < 23 (match Floks-main engines)
- TypeScript strict, no `any`
- Zod for all external/runtime validation
- ComputerProvider is the only way to touch compute; routes and MCP tools call ComputerService, never a concrete provider
- bird_id / flock_id are opaque foreign keys (string); no hard FK to Flok tables until post-G0 integration
- Prefer argv[] over shell strings; path canonicalization + root jail on every FS operation
- Capability tokens are 256-bit, stored as digests only
- Pair codes are one-use, short TTL, rate-limited
- Never persist terminal output, screenshots, cookies, or page contents by default
- Never put provider API keys (Runloop etc.) into a Node VM or MCP response

## Verification (must stay green)

```bash
npm run typecheck
# After domain tests exist:
npm run test:domain
# Isolation proof (no recent writes under Floks-main):
find /home/workdir/artifacts/Floks-main -type f -mmin -60 2>/dev/null | head
```

## Git workflow (independent repo)

```
feature branch (never main)
→ implement only the open phase
→ npm run typecheck (+ tests)
→ inspect diff
→ focused commit
→ push
→ PR / review
→ explicit merge approval
```

Do not force-push main. Do not mix Computer PRs with Flok product work.

## What this package must never do

- Re-scaffold or replace the main Flok application
- Rename birds / chirps tables or routes
- Use Docker containers as the production Agent Computer isolation boundary
- Describe the product as “just Devboxes,” “headless browser orchestration,” or claim residential proxies / bot-detection bypass / production-ready security
- Trust a Grok Bot-provided Node ID without pairing + capability
- Store provider secrets inside a Node
- Use MCP transport sessions as Node identity
- Create shared writable Node filesystems
- Expose provider IDs publicly
- Enable Nexus-IQ before Gate G0
- Pull `:latest` images

## Integration note

After Gate G0 this package becomes a dependency (or monorepo workspace) that Flok can import. Public surface will be:

- `ComputerService`
- `ComputerProvider` interface
- domain types + Zod schemas
- MCP tool registrar / handler

Until then it runs completely independently.
