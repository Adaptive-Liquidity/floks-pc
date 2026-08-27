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
4. `PHASES.md` — L0–L3 is the usable private-beta product; L4–L9 / G0 are backlog + historical C0–C6 / G0 lock
5. `docs/computers/agent-computer-cloud.md` then `docs/computers/` — product, architecture, MCP, security, provider contract
6. `src/lib/computers/` — domain types and ComputerProvider interface
7. `reference/flok-core/TAKE.md` — curated Flok conventions (read-only)

## Phase enforcement

**L0–L3 is enough for a usable private beta.** Do not treat L4–L9 as a mandatory pipeline. Do not automatically start L5 / L6 / L7 / L8 / G0. Merge only with explicit owner approval.

- L0 / C7 CLOSED (PR #17). L1 CLOSED (PR #21). L2 CLOSED (PR #22). L3 CLOSED (PR #23, `d118746`).
- L4 (PR #24) is **optional reliability insurance** (provider workspace snapshots / recovery). Merge only if the owner says merge. After L4, do not start another phase by default — operate one real private-beta session.
- Historical C0–C6 stay closed. Do not re-open them. Do not add MCP tools (stay at eight). Operator destroy/recover is `/operator/v1` + captured providerRef for the selected computer. MCP cannot destroy a Devbox. Do not add Fake AX, fake clicking, takeover, C9 handoffs, or proxy/bot-detection claims. FakeProvider is not product proof. L3 caps are not L7 billing.
- Shared Team Computers are **deferred** (`docs/computers/TEAM_COMPUTERS.md`). Default remains one bot, one isolated Agent Computer.
- Paid Agent Computers must use `flok-runloop-interactive` (or equivalent validated interactive stack). Fail before accepting generic compute-only DnD. Missing `flok-ui` / Xvfb / Chrome is not success. `fromEnv()` does not fall back to generic DnD.
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
→ implement only what the owner asked (do not start a new launch phase by default)
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
