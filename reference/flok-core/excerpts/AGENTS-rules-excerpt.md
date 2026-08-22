# Flok — agent instructions

This repository is **Flok**, an existing product. Do not scaffold a new app. Do not follow archived Next.js instructions.

## Read order

1. Current user instruction
2. `FINAL_DESIGN.md` — what Flok is
3. `BUILD.md` — what is built / what’s next
4. Verified code in `src/`
5. `BRAIN/TAKE.md` and `reference/spx402/` — implementation reference only
6. `docs/history/` — archives, not live specs

Root `ARCHITECTURE.md` and `DESIGN.md` are compatibility redirects.

## Rules

- Serve locally on `0.0.0.0:8080` (`npm run dev`).
- New copy: Node, Pulse, Cluster, Roost, Rack, Tape, Capsule, Bound, Contract, Grade.
- Do not rename `birds` / `chirps` / `/api/v1/chirps` until `BUILD.md` says so.
- Do not build Sky. Tape is the only feed.
- Hire Hall stays closed until SPX402 `OC_*` (S2).
- Do not treat BRAIN or `reference/spx402/` as the product spec.
- Smallest coherent change. No drive-by refactors.
- Verify: `npm run typecheck`, `npm test`, `bash scripts/smoke.sh`. `npm run verify` when CI lands.

## Preview sandbox

If you are inside Grok App Builder, also obey the sandbox contract already in that environment (port 8080, PGLite, live preview). Do not replace it with this file.

---

## Git / GitHub workflow

This section is the **authority** for how work is published. When `.grok/` exists, a `git-publish` skill may hold the procedure; it must not contradict this file.

### Default path

```
approved task
→ feature branch (never main)
→ implement
→ verify
→ inspect diff
→ focused commit
→ push
→ PR (draft until verified)
→ CI
→ review
→ explicit merge approval
→ update BUILD.md if status changed
```

Do not commit directly to `main`, silently push unfinished work, create duplicate PRs, mix unrelated changes, or bypass verification.

### Branches

- Never develop directly on `main`.
- Before starting approved work, confirm: current branch, working-tree status, remote/base branch, unrelated existing changes.
- Create a focused branch from current `main` for each approved phase/task.
