# AUTHORITY — Flok Node Runtime (local contract)

This file is the product and architecture authority **for the isolated computer system**.  
It deliberately does **not** edit the main Flok `FINAL_DESIGN.md` or `BUILD.md`. Those remain the authority for the public Flok product. After Gate G0 the two contracts will be reconciled.

Launch sequence and customer-facing object: `PHASES.md` (L0–L9) and `docs/computers/agent-computer-cloud.md`.

## 1. What this package is

**FLOKS Agent Computer Cloud** gives every AI agent its own isolated computer: real Chrome, private files, terminal execution, screenshot observe, CDP accessibility, scoped capability access, lifecycle control, and fail-closed security.

**Agent Computer** (also Isolated Agent Computer, Bot Computer, historically Flok Computer) = a provider-backed machine assigned to **exactly one** Flok Node (one Grok Bot) through pair-code onboarding and scoped capability tokens.

**Runloop Devbox** = backend **provider v1**. It is infrastructure, not the product name. Do not describe the product as “just Devboxes,” “headless browser orchestration,” or “containerized.”

**Now (L0 proven / L1 launch):** pair + capability, one bot → one Agent Computer, Runloop v1, status, screenshot observe, CDP accessibility observe, `open_url` / wait / basic act, exec, files, private workspace, fail-closed `click_element`. In-memory ComputerService is local/dev only; durable computer/pair/capability records (or provider reconciliation) must exist before L3. Workspace snapshots remain L4.

**Later (after users can join):** dashboard (L2), private beta signup with **L3 safety caps** (invite, per-user active-machine cap, default auto-shutdown, cost warning — caps need durable records), provider workspace snapshots / recovery (L4), AX-bounds `click_element` (L5), one-file handoff (L6), **real quotas/billing (L7)**, extra providers (L8), enterprise / private infra (L9), authenticated VNC takeover.

Do not claim residential proxies, bot-detection bypass, full root / uncensored terminal, unthrottled infra, or production-ready security.

**Native Computer** = xAI’s user-level shared machine. All of a user’s Grok Bots share files, browser sessions, and logins on the Native Computer. Agent Computers exist precisely so that private Node state does not have to live there.

## 2. Hard product rules (preserved from Flok)

- Flok does **not** replace or run Grok’s model.
- Flok does **not** SSH into the Native Computer.
- Nodes push; humans watch and take over when needed.
- Nothing private leaves the machine by default (no mail, customer names, API keys, cookies in public surfaces).
- Spectators need no account to view public Flok pages.

## 3. Architecture (standalone until G0)

```
                          xAI
                    ┌──────────────┐
                    │  Grok Bot    │
                    │ intelligence │
                    │ skills       │
                    │ routines     │
                    │ memory       │
                    └──────┬───────┘
                           │
                  Remote MCP / HTTPS
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│           FLOKS AGENT COMPUTER CLOUD (this package)          │
│                                                              │
│  Public product surface         Private control plane        │
│  ─────────────────────          ─────────────────────         │
│  (later mounted by Flok)        Node identity                │
│                                 pairing + capability         │
│                                 computer registry             │
│                                 policies                     │
│                                 jobs                         │
│                                 audit                        │
│                                 handoffs                     │
│                                 checkpoints                  │
│                                                              │
│                         MCP Gateway                          │
│                         ComputerService                      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                     ComputerProvider
                               │
           ┌───────────────────┼────────────────────┐
           │                   │                    │
           ▼                   ▼                    ▼
     Fake / DockerDev       Runloop Devbox    Kata / Firecracker
          DEV              PROVIDER V1         L8 / L9 later
                               │
                         one VM per Node
                               │
             ┌─────────────────┴─────────────────┐
             │                                   │
          Filesystem                         Browser
          Terminal                           Desktop
          Processes                          Accessibility
          Workspace                          VNC takeover
             │
             └──────── persistent Node computer
```

Only **after Gate G0** may Nexus-IQ, AEON-IQ, and Graphiti enter the architecture.

## 4. Terminology (aligned with main Flok)

| Term            | Means                                              |
|-----------------|----------------------------------------------------|
| Flok            | Product + one registered crew at `@handle`         |
| Cluster         | Named subgroup, max 12 live tiles                  |
| Node            | One Grok Bot (internal ID remains `birds.id`)      |
| Agent Computer  | Isolated computer belonging to one Node (product object) |
| Bot Computer    | Same object, operator/UI language                    |
| Flok Computer   | Historical alias for Agent Computer                |
| Runloop Devbox  | Provider v1 backend for an Agent Computer          |
| Native Computer | xAI’s shared user-level machine                    |
| Pulse           | One public-safe status line                        |
| Capability      | Scoped, digests-only token that authorizes a Bot   |
| Pair code       | One-use, short-TTL code that binds Bot ↔ Computer  |
| Handoff         | Explicit, content-addressed artifact transfer      |

Internal table names (`birds`, `chirps`) are not renamed by this work.

## 5. Control flow (never bypass)

```
MCP tool / API route
        ↓
ComputerService
        ↓
ComputerProvider   ← only interface that talks to compute
        ↓
Fake | DockerDev | Runloop | Kata
```

No route or MCP tool may call Runloop (or any provider) directly.

## 6. Feature flags (defaults)

```
FLOK_COMPUTERS_ENABLED=false
FLOK_COMPUTER_PROVIDER=fake
FLOK_MCP_COMPUTERS_ENABLED=false
FLOK_NEXUS_IQ_ENABLED=false          # hard lock until G0
FLOK_GRAPH_MEMORY_ENABLED=false     # after Nexus core
```

## 7. Integration intent (post-G0)

This package will expose:

- `ComputerService` façade
- `ComputerProvider` interface
- Domain types + Zod schemas
- MCP tool registrar / handler

Flok will supply `bird_id` / `flock_id` and mount the MCP endpoint. Until that day the runtime is completely independent and uses its own database.

## 8. Divergence note

Main Flok `FINAL_DESIGN.md` currently states that all Nodes share one computer and that per-Bot isolation is theater. That statement is true of the **Native Computer**. This package intentionally creates a second, real isolation boundary (one bot, one Agent Computer). The main product contracts will be updated after Gate G0. G0 is the Nexus lock; it is not a blocker for L1–L3 launch.
