# FLOKS Agent Computer Cloud

Product and launch plan for this repository. Historical engineering gates C0–C6 live in `PHASES.md`. This document is the customer-facing object. **L0–L3 is the usable private-beta product.** L4–L9 are backlog, not a required pipeline.

## 1. Product object: Agent Computer

An **Agent Computer** is a provider-backed machine assigned to exactly one bot identity through pair-code onboarding and scoped capability tokens.

**FLOKS Agent Computer Cloud** gives every AI agent its own isolated computer: real Chrome, private files, terminal execution, screenshot observe, CDP accessibility, scoped capability access, lifecycle control, and fail-closed security.

| Term | Means |
|------|--------|
| Agent Computer | The product object. Also: Isolated Agent Computer, Bot Computer. |
| FLOKS Agent Computer Cloud | The product: every bot gets its own isolated computer. |
| Runloop Devbox | Backend **provider v1** (infrastructure). Not the product name. |
| Native Computer | xAI’s shared user-level machine. Agent Computers exist so private bot state does not live there. |
| One bot, one computer | Pairing binds exactly one `bird_id` / `flock_id` to one Agent Computer. Default. Do not weaken. Optional shared-trust Team Computers are deferred: `TEAM_COMPUTERS.md`. |

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
L1  Launch MVP                  CLOSED — PR #21 live remote HTTPS + Runloop
L2  Beta dashboard              CLOSED — PR #22 Live Node Console
L3  Private beta                CLOSED — PR #23 d118746  ← usable product
L4  Reliability / recovery      optional insurance (PR #24). Not a beta blocker
L5  Safer browser control       OPEN — click_element from last observe AX bounds
L6  Team / workflow             backlog — explicit one-file handoff
L7  Scale / quotas / billing    backlog — not L3 caps
L8  Provider fabric             backlog — keep Runloop v1
L9  Enterprise / private infra  backlog
```

Users may join at L3 with **minimal safety caps** (invite, per-user active-machine cap, default auto-shutdown, visible cost). That is enough for private beta. L4 snapshots shipped as optional insurance. L5 `click_element` is owner-requested (PR #26; merge only with owner approval). Handoffs (L6), **real quotas/billing (L7)**, extra providers, and shared Team Computers stay backlog — build only if real use shows a blocker. Nexus-IQ / AEON / Graphiti remain forbidden until Gate G0 in `PHASES.md`. G0 is the pre-Nexus acceptance gate; it is not defined by Nexus/AEON features. G0 is not a private-beta blocker.

L1 MCP has **two** start paths. Default listen host is loopback. Do not omit the interactive blueprint.

**A. Local/operator smoke test** — `FLOK_MCP_LISTEN_HOST=127.0.0.1` (the default). Local-only. A remote Grok Bot **cannot** connect. Use this for local curl or a local connector only.

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

**B. Real remote Grok Bot test** — requires an **authenticated HTTPS** tunnel or reverse proxy in front of the MCP server, `FLOK_MCP_AUTH_TOKEN` set, and an external MCP URL that is HTTPS. Do not expose unauthenticated public MCP. Do not imply `127.0.0.1` works for a remote Grok Bot. MCP runs on the operator host (not inside the Devbox); use an operator HTTPS tunnel/proxy. Do not pick a single vendor here.

```bash
FLOK_MCP_COMPUTERS_ENABLED=1 \
FLOK_MCP_PROVIDER=runloop \
FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive \
FLOK_MCP_AUTH_TOKEN="<wrapper-bearer>" \
FLOK_MCP_BASE_URL="https://<operator-https-host>/mcp" \
FLOK_MCP_BOOTSTRAP=1 \
FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local \
FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local \
npm run start:mcp
```

Point the Grok Bot MCP connector at that HTTPS URL and send `Authorization: Bearer <FLOK_MCP_AUTH_TOKEN>`. Binding a non-loopback listen host also requires `FLOK_MCP_AUTH_TOKEN`. Setting `FLOK_MCP_BASE_URL` without a token, or to `http://` / loopback, refuses startup. Full checklist: `docs/computers/REMOTE_GROK_MCP.md`.

**127.0.0.1 is not a real remote Grok Bot endpoint. A remote Grok Bot needs an authenticated HTTPS endpoint that forwards to the MCP server and requires FLOK_MCP_AUTH_TOKEN.**

Pair with the bootstrap identities. Then **shut down only the Devbox created by this run** using the runbook below. Stopping MCP is not shutdown.

### Control-plane persistence (before L3)

In-memory `ComputerService` is acceptable for **local/dev only**. It is **not** acceptable for private beta. If MCP restarts, FLOKS must not forget active Agent Computers. Active-machine caps require durable records or provider reconciliation. Durable **provider workspace snapshots** remain **L4**. Durable computer/pair/capability records must be **L1/L3**.

Before L3 private beta, FLOKS must persist or reconcile ComputerRecord, providerRef, bird_id, flock_id, owner/workspace, pair-code digest state, capability digest/scope/expiry/revocation state, and active-machine accounting. Raw capability tokens are never stored. Provider workspace snapshots remain L4.

### Paid Runloop shutdown / destroy runbook

**MCP cannot destroy a Devbox.** The eight MCP tools do not call `ComputerService.stop()` or `transition(..., "deleted")`. `computer_status` returns only `state` / `last_active_at` — never a provider id. Do **not** add a ninth MCP tool for L1. Do not publish real provider IDs.

**`Ctrl+C`, SIGTERM, and stopping `npm run start:mcp` do not destroy the Devbox.** Keep-alive (default 900s, `FLOK_RUNLOOP_KEEP_ALIVE_SECONDS` 60–3600) is a **timeout fallback**, not the cleanup path.

**Only shut down the Devbox created by this FLOKS run. Never bulk-shutdown all Devboxes returned by the Runloop account.**

Safe selection (control-plane API; key stays in your shell):

1. Keep `RUNLOOP_API_KEY` in the operator environment only. Never commit it, never paste it into chat/PRs/logs, never put it in the guest.
2. **Prefer the captured `providerRef` from this run’s creation response or local operator log.** Bootstrap stdout `computer=` is the internal ComputerService id, **not** the Runloop id. Do not paste real provider IDs into docs or PRs.
3. If you do not have that id, filter the account list by FLOKS metadata/name and creation time (`purpose=agent-computer`, `bird_id`, `flock_id`, workspace/user, `floks_run_id`). An unfiltered `GET /v1/devboxes` is **not** a shutdown list.
4. If more than one candidate matches, **stop and manually verify**. If unsure, **do not shut down anything**. Never shut down unrelated Runloop workloads.

```bash
# Shutdown only the captured id from THIS run (placeholder, not a real id).
curl -sS -X POST \
  -H "Authorization: Bearer ${RUNLOOP_API_KEY}" \
  "https://api.runloop.ai/v1/devboxes/dbx_REDACTED/shutdown"
```

5. Verify that **this** id is `shutdown`. Do not sweep the rest of the account.

**L1 implementation requirement:** FLOKS-created Runloop Devboxes must carry identifying metadata such as `floks_run_id`, workspace/user, `bird_id`, `flock_id`, and `purpose=agent-computer` so cleanup and reconciliation can target only owned machines.

**L1 before beta:** an operator who did not write this repo must be able to shut down **this run’s** Agent Computer without touching other workloads. L2 may later put a destroy button on the dashboard that calls the same control-plane `destroy` for the selected computer only.

### L1 interactive blueprint validation

An Agent Computer is the **interactive** stack. L1 must **fail before accepting a paid computer** when:

- `FLOK_RUNLOOP_BLUEPRINT` is missing, empty, or misspelled
- the value is the generic compute-only image `runloop/universal-ubuntu-24.04-x86_64-dnd` (or any image without `flok-ui` / Xvfb / Chrome)
- the guest has no `flok-ui` user or no Xvfb (missing Xvfb must **not** be treated as success)

Required: `FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive` or an equivalent **owner-validated** interactive stack.

L1 implementation: `RunloopProvider.fromEnv()` requires `flok-runloop-interactive` (or `FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT`). Generic DnD is rejected unless `FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY=1` (C3A live compute tests only). Missing `flok-ui` / Xvfb / Chrome fails before the computer is ready.

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
| Private files (stat/list/read/write/mkdir/move/copy/delete) | Proven live on Runloop (PR #20 MCP fs smoke). Not an L1 blocker. |
| Lifecycle stop/destroy | Control-plane `ComputerService.stop` / `destroy` exist. **MCP cannot invoke them.** Operator uses the Runloop shutdown API (this doc). L1 must make that obvious before beta. |
| `click_element` from last observe AX | L5. Guessed/offscreen/unmapped clicks fail closed. FakeProvider is not live proof. |
| Cleanup / Devbox shutdown | L0 cleanup proof: Devbox shutdown was verified through the Runloop provider/API. Provider ID redacted. Not via MCP or `Ctrl+C`. Never bulk-shutdown the account. |
| Durable ComputerRecord / pair / capability / active-machine accounting | **Required before L3.** In-memory is local/dev only. Raw capability tokens are never stored. |
| Provider workspace snapshots | **L4 optional insurance** (PR #24). Provider-native checkpoint/restore. Not required before private beta. Not a substitute for control-plane records. |
| Takeover / public VNC | Fail-closed. Not launch. |
| Handoffs | `PHASE_NOT_STARTED` (L6). Still listed as two of the eight tools. |
| Dashboard / cost / pair UI | L2. |
| Sign-up / invite / L3 safety caps | L3: per-beta-user active-machine cap, default auto-shutdown, visible cost warning, manual invite. |
| Real quotas / billing / observability | **L7** (not L3). |
| CredentialBroker / proxies / network policy | After L3. Not claimed. |
| Provider fabric / microVM / bare metal | L8/L9. Runloop stays v1. |

## 5. Launch gates

**L0 (closed).** A real Grok Bot called `computer_observe({ include_accessibility: true })` and received `accessibility_summary.source === "cdp"` with non-empty nodes from a real Runloop Agent Computer. Evidence: Adaptive-Liquidity/floks-pc#17 squash `bda72e0` (2026-08-26). Pair as `bird-local` / `flock-local`. No FakeProvider. No new MCP tools.

**L1.** A real Grok Bot can pair to an **interactive** Agent Computer (`flok-runloop-interactive` or equivalent; generic DnD rejected), observe browser state, use files/exec, and the operator can shut down **this run’s** Devbox with the Runloop API runbook (MCP cannot destroy; `Ctrl+C` does not). `127.0.0.1` is local smoke only; a remote Grok Bot needs authenticated HTTPS + `FLOK_MCP_AUTH_TOKEN`.

**L2.** A non-engineer can see: this bot has this computer, it is running, this is what it sees, these are its permissions, this is how I stop it.

**L3.** Users can join via invite/approval, connect a bot, get an Agent Computer, run basic browser/files/exec workflows, see a cost warning, stay under a per-user active-machine cap with default auto-shutdown, and report bugs without a live walkthrough every time. Control-plane records are durable (or reconciled with the provider); in-memory ComputerService is not beta.

## 6. Known limitations

- `click_element` uses the last `observe({ include_accessibility: true })` AX bounds (15s). Guessed, offscreen, unmapped, and same-batch-after-mutate clicks fail closed. Do not treat FakeProvider trees as live proof.
- `capabilities().accessibility` remains `false` until an explicit later lift.
- MCP `computer_fs` write-ok / read-empty was an L0-era note. Live Runloop MCP fs smoke passed on PR #20. **Not a current L1 blocker.** Do not reopen it as launch work.
- In-memory `ComputerService` is acceptable for local/dev only. It is **not** acceptable for private beta. Set `FLOK_CONTROL_PLANE_PATH` (Runloop MCP defaults to `.flok/control-plane.json`). Provider workspace snapshots remain L4.
- Operator destroy (not an MCP tool): `FLOK_MCP_PROVIDER=runloop FLOK_DESTROY_CONFIRM=1 FLOK_DESTROY_PROVIDER_REF=<captured> npm run computers:destroy-run`. Requires the captured providerRef from this run. If more than one candidate matches or unsure, the command stops.
- Handoffs are not implemented.
- Takeover / authenticated VNC is not implemented.
- Public HTTPS `POST /mcp` is an operator tunnel/proxy choice, not a claim that FLOKS hosts a production cloud. **127.0.0.1 is not a real remote Grok Bot endpoint. A remote Grok Bot needs an authenticated HTTPS endpoint that forwards to the MCP server and requires FLOK_MCP_AUTH_TOKEN.**
- Interactive Agent Computers need `FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive` (or equivalent validated stack). Generic DnD Ubuntu has no `flok-ui` and is not an Agent Computer. `RunloopProvider.fromEnv()` uses `resolveAgentComputerBlueprint()` and **fails closed** on missing/generic DnD unless `FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY=1` (C3A live compute tests only). Missing `flok-ui` / Xvfb / Chrome fails **before** the computer is ready. This is shipped L1 behavior, not an open gap.
- MCP has **no** stop/destroy tool. `Ctrl+C` does not shut the Devbox down. Use the shutdown runbook.
- Default live keep-alive is 15 minutes unless `FLOK_RUNLOOP_KEEP_ALIVE_SECONDS` is set (60–3600). That is a fallback, not cleanup.
- Chrome `.deb` is unpinned stable channel.
- `--remote-allow-origins=*` is loopback-only CDP; narrowing is deferred.
- Production scale, residential egress, and bot-detection bypass are **not** claimed.

## 7. Safety rules

- Exactly eight MCP tools. Launch MVP does not add tools.
- Capability token after pair is the only Bot computer authority. Wrapper Bearer / MCP session / `~/flok/token` are not.
- Fail closed: empty CDP dumps, guessed clicks, path escapes, cross-bot access, missing `flok-ui`.
- Never persist terminal output, screenshots, cookies, or page contents by default.
- Never put `RUNLOOP_API_KEY` in the guest, logs, or MCP responses.
- Destroy/shutdown must be obvious. MCP cannot destroy. Process stop does not destroy the Devbox. Only shut down the Devbox created by this FLOKS run. Never bulk-shutdown all Devboxes returned by the Runloop account.
- Do not run paid Runloop in required PR CI.

## 8. What not to claim

- Residential proxies or “never trips bot detection.”
- Full root shell / uncensored terminal / unthrottled infra.
- Production-ready security or proven multi-tenant scale.
- FakeProvider observe/act/fs as C7 or L0/L1 product proof.
- That `click_element` works.
- That MCP fs write-ok/read-empty is still an L1 blocker (PR #20 live smoke passed).
- That MCP or `Ctrl+C` destroys a paid Devbox, or that an unfiltered account list is a shutdown list.
- That `127.0.0.1` is a remote Grok Bot endpoint.
- That generic DnD Ubuntu is an Agent Computer.
- That this repo has replaced the main Flok application (see `AGENTS.md` zero-write rule).
