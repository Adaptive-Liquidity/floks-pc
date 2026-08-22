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
3. `AUTHORITY.md` — what the Flok Computer is
4. `PHASES.md` — current phase + gates
5. `docs/computers/` — architecture, security, provider contract
6. `src/lib/computers/` — domain types and ComputerProvider interface
7. `reference/flok-core/TAKE.md` — curated Flok conventions (read-only)

## Phase enforcement

Work only on the currently open phase listed in `PHASES.md`.

- Phase 0 / Gate C0: docs + types + interface only (this scaffold).
- Do not implement FakeProvider body, DockerDev, Daytona, migrations, worker, or MCP server until the corresponding phase is open.
- Do not enable or import Nexus-IQ, AEON, Graphiti, or any memory plane until Gate G0 is explicitly marked PASSED.

## Hard locks (never relax)

```
FLOK_NEXUS_IQ_ENABLED=false
FLOK_GRAPH_MEMORY_ENABLED=false
```

Nexus-IQ work begins only after the standalone Flok Computer has passed full end-to-end acceptance (Gate G0).

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
- Never put provider API keys (Daytona etc.) into a Node VM or MCP response

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
- Use Docker containers as the production Node isolation boundary
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
