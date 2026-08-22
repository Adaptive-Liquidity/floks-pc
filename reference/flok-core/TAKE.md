# reference/flok-core — Take list

**Not executable Flok source.**  
This folder holds curated, read-only excerpts so coding agents can match Flok conventions (terminology, ID style, Kysely/db patterns, migration headers, AGENTS rules) without importing runtime code from `/home/workdir/artifacts/Floks-main/`.

Authority for the computer system remains `AUTHORITY.md` + `PHASES.md` inside this package.

## Taken (and why)

| Item | Source (Floks-main) | Purpose in this package |
|------|---------------------|-------------------------|
| Terminology table | FINAL_DESIGN.md §2 | Keep Node / Cluster / Pulse / Grade language consistent |
| Agent rules excerpt | AGENTS.md (Git / verify / no birds rename) | Coding agents stay aligned with main product constraints |
| Node engines | package.json `engines` | Match Node ≥22.12 <23 for eventual integration |
| ID / naming style | src/lib/ids.ts (pattern) | Opaque string IDs, consistent casing |
| DB access style | src/lib/db.ts (pattern) | Kysely + PGLite conventions when migrations arrive |
| Migration header style | migrations/0002_flok.sql | SQL style, comments, versioning |
| Last known migration | migrations/ (0011) | Avoid collision; computer migrations start in this package’s own sequence |

## Explicitly not taken

- Any executable route, component, or server code
- Auth implementation
- SPX402 / Outcome Contract logic
- BRAIN reference packs beyond the discipline of a TAKE.md
- Live imports or symlinks that could mutate Floks-main

## Update rule

When a new convention is needed, copy a minimal excerpt and add a row to this table. Never add a runtime dependency on Floks-main.
