# FLOKS Agent Computer Cloud

Product and launch plan for this repository. Historical engineering gates C0–C6 live in `PHASES.md`. This document is the customer-facing object and the launch-fast roadmap.

## 1. Product object: Agent Computer

An **Agent Computer** is a provider-backed machine assigned to exactly one bot identity through pair-code onboarding and scoped capability tokens.

**FLOKS Agent Computer Cloud** gives every AI agent its own isolated computer: real Chrome, private files, terminal execution, screenshot observe, CDP accessibility, scoped capability access, lifecycle control, and fail-closed security.

| Term | Means |
|------|--------|
| Agent Computer | The product object. Also: Isolated Agent Computer, Bot Computer. |
| FLOKS Agent Computer Cloud | The product: every bot gets its own isolated computer. |
| Runloop Devbox | Backend **provider v1** (infrastructure). Not the product name. |
| Native Computer | xAI’s shared user-level machine. Agent Computers exist so private bot state does not live there. |
| One bot, one computer | Pairing binds exactly one `bird_id` / `flock_id` to one Agent Computer. |

Do not describe this as “just Devboxes,” “headless browser orchestration,” or “containerized” (v1 isolation is VM-backed). Do not claim a full root shell, uncensored terminal, unthrottled infrastructure, residential proxies, or that traffic “never trips bot detection.”

## 2. Backend v1: Runloop Devbox

Runloop is the working production-v1 `ComputerProvider`. Do not replace it for launch.

- Interactive blueprint: `flok-runloop-interactive` (creates `flok-ui`, Chrome, private display). The generic DnD Ubuntu blueprint is compute-only and is **not** an Agent Computer.
- Workspace jail: `/home/user/flok`.
- Chrome as `flok-ui` without `--no-sandbox`.
- CDP loopback only: `127.0.0.1:9222`. Never `0.0.0.0`.
- `ComputerService` is the only path from MCP tools to the provider.

Later backends (browser-only, cheaper workers, microVM, private cloud) are **Phase L8/L9**. The customer still sees an Agent Computer.

## 3. MVP launch path

```
L0  C7 landing / proof lock     CLOSED — PR #17, live Grok Bot CDP AX
L1  Launch MVP                  OPEN — one bot, one working Agent Computer
L2  Beta dashboard              Bot Computers / Live Node Console
L3  Private beta                Sign-up / invite while upgrades continue
L4  Reliability / recovery      C8-class persistence (after users can join)
L5  Safer browser control       click_element from real CDP bounds
L6  Team / workflow             Explicit one-file handoff
L7  Scale / quotas / billing
L8  Provider fabric             Keep Runloop v1; add options later
L9  Enterprise / private infra
```

Users may join at L3. Snapshots, click_element, handoffs, quotas, and extra providers ship **after** that. Nexus-IQ / AEON / Graphiti remain forbidden until Gate G0 in `PHASES.md`.

L1 operator start (owner-approved paid Runloop; not CI):

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_MCP_PROVIDER=runloop \
FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive \
FLOK_MCP_BOOTSTRAP=1 \
FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local \
FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local \
npm run start:mcp
```

Pair with those exact identities. Destroy/shutdown the Devbox when done — stopping MCP does not always destroy the machine. Default keep-alive is 15 minutes.

## 4. Feature matrix

| Capability | Status |
|------------|--------|
| Real Grok Bot MCP connection | Proven (L0). Exactly eight tools. |
| Pair code onboarding | Proven. |
| Scoped capability tokens | Proven. |
| Runloop Devbox provider v1 | Proven. |
| Isolated Linux workspace | Proven. |
| Real Chrome in guest (`flok-ui`) | Proven (interactive blueprint). |
| Loopback CDP (`127.0.0.1:9222`) | Proven. No `--no-sandbox`. |
| CDP accessibility observe | Proven live: `accessibility_summary.source === "cdp"` with non-empty nodes. FakeProvider is **not** proof. `capabilities().accessibility` stays `false`. |
| Screenshot observe | Proven. |
| `open_url` / wait / basic act | Proven path. Observe may start Chrome when CDP is down (Grok may block `open_url` as UI automation). |
| Terminal / exec | Proven. |
| Private files (stat/list/read/write/mkdir/move/copy/delete) | Implemented; **MCP fs write-ok / read-empty is a known bug** (fix in L1). |
| Lifecycle stop/destroy | Implemented; operator flow must be obvious (L1). |
| Fail-closed `click_element` | Current. Not a launch blocker. Real AX-bounds click is L5. |
| Cleanup / Devbox shutdown | Proven on the L0 live box (`dbx_34DcbsIeIV236eUxzxKsR`). |
| Takeover / public VNC | Fail-closed. Not launch. |
| Handoffs | `PHASE_NOT_STARTED` (L6). Still listed as two of the eight tools. |
| Snapshots / pause-wake polish | L4. |
| Dashboard / cost / pair UI | L2. |
| Sign-up / waitlist / limits | L3. |
| CredentialBroker / proxies / network policy | After L3. Not claimed. |
| Provider fabric / microVM / bare metal | L8/L9. Runloop stays v1. |

## 5. Launch gates

**L0 (closed).** A real Grok Bot called `computer_observe({ include_accessibility: true })` and received `accessibility_summary.source === "cdp"` with non-empty nodes from a real Runloop Agent Computer. Evidence: Adaptive-Liquidity/floks-pc#17 squash `bda72e0` (2026-08-26). Pair as `bird-local` / `flock-local`. No FakeProvider. No new MCP tools.

**L1.** A real Grok Bot can pair, use its assigned Agent Computer, observe browser state, use files/exec, and the operator can safely stop/destroy the computer.

**L2.** A non-engineer can see: this bot has this computer, it is running, this is what it sees, these are its permissions, this is how I stop it.

**L3.** Users can join, connect a bot, get an Agent Computer, run basic browser/files/exec workflows, and report bugs without a live walkthrough every time.

## 6. Known limitations

- `click_element` is fail-closed until L5. Do not treat FakeProvider trees as proof.
- `capabilities().accessibility` remains `false` until an explicit later lift.
- MCP `computer_fs`: write can succeed and the file exist on disk while a following MCP read returns empty. Separate from C7 AX. **L1 blocker.**
- In-memory ComputerService store until L4.
- Handoffs are not implemented.
- Takeover / authenticated VNC is not implemented.
- Public HTTPS `POST /mcp` is still an operator/deploy choice, not a claim that FLOKS hosts a production cloud.
- Interactive Agent Computers need `FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive`. Generic DnD Ubuntu has no `flok-ui`.
- Default live keep-alive is 15 minutes unless `FLOK_RUNLOOP_KEEP_ALIVE_SECONDS` is set (60–3600).
- Chrome `.deb` is unpinned stable channel.
- `--remote-allow-origins=*` is loopback-only CDP; narrowing is deferred.
- Production scale, residential egress, and bot-detection bypass are **not** claimed.

## 7. Safety rules

- Exactly eight MCP tools. Launch MVP does not add tools.
- Capability token after pair is the only Bot computer authority. Wrapper Bearer / MCP session / `~/flok/token` are not.
- Fail closed: empty CDP dumps, guessed clicks, path escapes, cross-bot access, missing `flok-ui`.
- Never persist terminal output, screenshots, cookies, or page contents by default.
- Never put `RUNLOOP_API_KEY` in the guest, logs, or MCP responses.
- Destroy/shutdown must be obvious; MCP process stop does not always destroy the Devbox.
- Do not run paid Runloop in required PR CI.

## 8. What not to claim

- Residential proxies or “never trips bot detection.”
- Full root shell / uncensored terminal / unthrottled infra.
- Production-ready security or proven multi-tenant scale.
- FakeProvider observe/act as C7 or L0 proof.
- That `click_element` works.
- That fs read is proven end-to-end on live Runloop until the write-ok/read-empty bug is fixed.
- That this repo has replaced the main Flok application (see `AGENTS.md` zero-write rule).
