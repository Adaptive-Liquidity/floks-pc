# AUTHORITY — Flok Node Runtime (local contract)

This file is the product and architecture authority **for the isolated computer system**.  
It deliberately does **not** edit the main Flok `FINAL_DESIGN.md` or `BUILD.md`. Those remain the authority for the public Flok product. After Gate G0 the two contracts will be reconciled.

## 1. What this package is

**Flok Computer** = a genuine isolated computer that belongs to exactly one Flok Node (one Grok Bot).

It provides:

- Persistent filesystem and workspace
- Terminal / process execution
- Browser + computer-use + accessibility
- Human desktop takeover (VNC)
- Checkpoint / restore
- Explicit handoffs between Nodes
- Capability-based security
- Audit metadata (no private content by default)

**Native Computer** = xAI’s user-level shared machine. All of a user’s Grok Bots share files, browser sessions, and logins on the Native Computer. Flok Computers exist precisely so that private Node state does not have to live there.

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
│                   FLOK NODE RUNTIME                          │
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
     Fake / DockerDev       Daytona VM       Kata / Firecracker
          DEV              PRODUCTION V1       OWN COMPUTE
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
| Flok Computer   | Isolated computer belonging to one Node            |
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
Fake | DockerDev | Daytona | Kata
```

No route or MCP tool may call Daytona (or any provider) directly.

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

Main Flok `FINAL_DESIGN.md` currently states that all Nodes share one computer and that per-Bot isolation is theater. That statement is true of the **Native Computer**. This package intentionally creates a second, real isolation boundary. The main product contracts will be updated after Gate G0 demonstrates that the Flok Computer works.
