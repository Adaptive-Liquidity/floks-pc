# FLOKS PC — Build, Parallel-Agent, Git, Review, and Merge Operating Instructions

**Repository:** `Adaptive-Liquidity/floks-pc`  
**Working project:** `flok-node-runtime` / `floks-pc` only  
**Product:** FLOKS Agent Computer Cloud (one bot, one Agent Computer; Runloop is provider v1)  
**Main Flok source:** `/workspace/artifacts/Floks-main/` or `/home/workdir/artifacts/Floks-main/` — READ ONLY  
**Current product:** L0–L3 private beta is CLOSED and usable. L4 (PR #24) is optional insurance — merge only if the owner says merge. Do **not** automatically start L5 / L6 / L7 / L8 / G0. `PHASES.md` lists L4–L9 as backlog, not a required pipeline.  
**Hard gate:** Nexus-IQ / AEON / Graphiti remain disabled until Gate G0 is explicitly PASSED. G0 is not an L1–L3 launch blocker.

This document defines the mandatory operating procedure for Grok Build, subagents, worktrees, commits, CI, PR reviews, review-comment verification, fixes, gate closure, and merges.

---

## 1. Authority order

Every session must obey:

1. Current user instruction
2. `AGENTS.md`
3. `AUTHORITY.md`
4. `PHASES.md`
5. `docs/computers/*`
6. Current implementation and tests
7. `reference/flok-core/*` for conventions only

If a lower-level instruction conflicts with a higher-level instruction, stop and report the conflict.

---

## 2. Hard repository isolation

`Floks-main` is READ ONLY.

Never:

- edit, create, delete, rename, migrate, stage, commit, or push anything under `Floks-main`;
- import runtime modules from `Floks-main`;
- depend on `Floks-main` database tables;
- run `Floks-main` migrations;
- reuse `Floks-main` secrets;
- require `Floks-main` to start;
- use it as a writable worktree;
- modify it to make `floks-pc` tests pass.

Allowed:

- read-only inspection;
- use of `reference/flok-core` as a copied convention pack;
- opaque external Flok/Node IDs;
- independent integration contracts.

Any write to `Floks-main` is stop-the-line.

---

## 3. Phase discipline

Work only on the phase marked CURRENT in `PHASES.md`.

Never fan out implementation across future phases.

Parallelism is allowed only for independent slices inside the current phase.

Nexus, Nexus-IQ, AEON, Graphiti, and graph-memory work remain forbidden until Gate G0 is explicitly marked PASSED.

Hard flags remain false:

```text
FLOK_NEXUS_IQ_ENABLED=false
FLOK_GRAPH_MEMORY_ENABLED=false
```

---

## 4. Subagent types

Use the narrowest suitable child.

### `explore`
Use for read-only inspection:

- source layout;
- provider contracts;
- existing tests;
- Floks-main conventions;
- dependency mapping;
- review evidence.

No implementation edits.

### `plan`
Use for:

- current-phase implementation plan;
- gate checklist;
- dependency reasoning;
- review strategy.

No implementation edits.

### `general-purpose`
Use for one bounded implementation slice.

A writing child may:

- edit only assigned files;
- run focused tests;
- create a focused LOCAL commit.

A writing child may not:

- push;
- merge;
- close a gate;
- advance phases;
- edit `PHASES.md` unless explicitly assigned by the parent;
- modify files outside its ownership list.

---

## 5. Critical child-prompt rule

Do not rely on inherited context, parent Plan Mode, or an assumed compacted `AGENTS.md` as a security boundary.

Every child prompt must explicitly repeat:

- repository;
- authority order;
- current phase;
- Floks-main zero-write rule;
- forbidden future-phase technologies;
- hard feature flags;
- Node version;
- exact files owned;
- tests required;
- Git permissions;
- required return evidence.

Subagents are not independent GitHub identities and cannot provide independent GitHub approval.

---

## 6. Parallel-builder rules

Parallelize independent work, not phases.

### Good

- Explorer: read current provider contract.
- Planner: prepare current gate checklist.
- Builder A: provider implementation.
- Builder B: integration tests in separate files.
- Reviewer A: code correctness.
- Reviewer B: security/scope.
- Verifier: independently verify review findings.

### Bad

- two agents editing the same source file;
- multiple agents updating `PHASES.md`;
- Phase 2 and Phase 3 builders running together;
- subagents pushing competing branches;
- multiple writers in one shared workspace with overlapping ownership.

---

## 7. File ownership

One writer owns one file at a time.

Every writer prompt must state:

```text
You may modify ONLY:
- path/a
- path/b
```

If another file is required, stop and report it. The parent decides whether to expand scope.

---

## 8. Worktree policy

### `isolation: none`

Use when only one writer is active.

### `isolation: worktree`

Use for simultaneous independent writers.

Before spawning worktree writers:

- parent branch should be clean;
- current phase branch should be created;
- each builder gets disjoint files.

Each builder:

1. reads authority files;
2. edits assigned files;
3. runs focused verification;
4. inspects its own diff;
5. creates a focused local commit;
6. never pushes;
7. returns commit SHA + evidence.

Only the parent integrates.

---

## 9. Phase start

Parent/integrator should begin a phase from fresh `main`:

```bash
git status
git fetch origin
git switch main
git pull --ff-only origin main
git status
git switch -c feat/<phase>-<short-name>
```

Do not intentionally start parallel writers from a dirty tree unless those changes are meant to be inherited.

---

## 10. Standard builder prompt

Every writing child gets:

```text
REPOSITORY
/workspace/artifacts/flok-node-runtime only.

AUTHORITY
AGENTS.md
→ AUTHORITY.md
→ PHASES.md
→ docs/computers/*

OPEN PHASE
<current phase only>

ABSOLUTE PROHIBITIONS
- ZERO WRITE under /workspace/artifacts/Floks-main/
- no future-phase implementation
- no Nexus / Nexus-IQ / AEON / Graphiti before G0
- no PHASES.md gate closure
- no git push
- no merge
- no changes outside assigned files

HARD FLAGS
FLOK_NEXUS_IQ_ENABLED=false
FLOK_GRAPH_MEMORY_ENABLED=false

ENVIRONMENT
Node >=22.12 <23.

FILE OWNERSHIP
You may modify ONLY:
<explicit paths>

GIT
You may create one focused LOCAL commit.
Never push.

RETURN
- summary
- exact files changed
- exact tests run + results
- commit SHA
- unresolved risks
```

---

## 11. Parent/integrator is the only upstream operator

Only the parent/integrator may:

- cherry-pick/integrate child commits;
- resolve conflicts;
- modify shared integration files;
- update `PHASES.md`;
- close a phase gate;
- push remote branches;
- create/update PRs;
- request reviews;
- triage review findings;
- decide whether comments are valid;
- merge after explicit approval.

Subagents never push.

No actor pushes directly to `main`.

---

## 12. Worktree integration

Inspect every child commit before integrating:

```bash
git show <sha>
```

Then:

```bash
git cherry-pick <sha>
```

The parent resolves conflicts and reruns verification.

Do not let children independently resolve shared integration conflicts.

---

## 13. Commit policy

Use focused conventional commits.

Examples:

```text
feat(c2): add Docker development provider
test(c2): prove isolated persistent volumes
fix(review): clean resources after failed provision
fix(review): reject workspace escape
ci: add runtime verification
docs(c2): record Gate C2 evidence
```

Keep review-fix commits visible until review is complete. Squash at merge time if desired.

---

## 14. Verification policy

`npm run verify` should become the broad non-paid verification gate.

Minimum target:

```text
typecheck
all local/non-paid tests
build
```

Conceptually:

```json
"verify": "npm run typecheck && npm test && npm run build"
```

Phase-specific Docker/MCP/security checks may be separate jobs.

Paid provider tests such as Runloop live tests remain opt-in or scheduled.

---

## 15. GitHub CI

CI must exist before relying on PR discipline.

Minimum:

```text
checkout
Node 22
npm ci
npm run verify
```

Add as phases mature:

```text
Docker C2 integration
MCP contract
provider contract
security tests
container scanning
```

Do not require paid Runloop live tests on every PR.

---

## 16. `main` rules

Protect `main` with a GitHub repository ruleset. **GitHub blocks merges. GitHub Actions runs the named jobs. Cursor only edits files and can respond when a check or review fails. The ruleset does not start Cursor.**

The intended ruleset is `.github/rulesets/main-protection.json` (JSON only; protocol lives in `.github/MERGE_GATE.md`). Apply it with Administration credentials against GitHub's rulesets API:

```text
GH_ADMIN_TOKEN=... npm run protect:main
```

Require:

- pull request before merge (squash only);
- required GitHub Actions check names, which must match job `name:` fields exactly:
  `verify` (typecheck + tests + build), `docker-c2` (Docker isolation), `merge-gate` (security/policy scripts);
- conversation resolution optional (currently off on the live ruleset);
- merge-gate classification replies on every review thread (Actions job, see `.github/MERGE_GATE.md`);
- branch up-to-date with `main`;
- no force push;
- no direct pushes;
- no branch deletion where appropriate.

Do not require paid Runloop live tests.

If there is only one human GitHub identity, do not require one approving review yet because authors cannot approve their own PR.

When another trusted human reviewer is available:

- require at least one approval;
- dismiss stale approvals after new commits.

---

## 17. PR lifecycle

Mandatory path:

```text
origin/main
   ↓
feature branch
   ↓
parallel local builder commits
   ↓
parent integration
   ↓
full local verification
   ↓
push feature branch
   ↓
DRAFT PR
   ↓
CI
   ↓
independent code/test/security reviews
   ↓
VERIFY EVERY REVIEW FINDING
   ↓
fix valid findings only
   ↓
CI AGAIN
   ↓
fresh review
   ↓
resolve conversations
   ↓
explicit merge approval
   ↓
squash merge to main
```

Never merge merely because the first CI run is green.

---

## 18. Never blindly fix review comments

A review comment is a claim, not an instruction.

Every comment must first be independently classified:

```text
confirmed
partially-confirmed
unsupported
stale
question
out-of-scope
```

For each comment, require evidence:

- exact file/line;
- governing spec/rule;
- reproduction or failing test when practical;
- risk if left unchanged.

Then choose:

```text
must fix
should fix
no code change
defer
```

Do not tell an agent to "fix all comments."

---

## 19. Review-comment verification format

Use a read-only reviewer/verifier:

```text
For every unresolved review comment, return:

COMMENT
<short identifier / summary>

VALIDITY
confirmed | partially-confirmed | unsupported | stale | question | out-of-scope

EVIDENCE
- exact code path/line
- relevant AGENTS/AUTHORITY/PHASES rule
- test/reproduction if applicable

ACTION
must fix | should fix | no change | defer

RISK
low | medium | high | critical
```

Only confirmed/partially-confirmed actionable findings go to a fixer.

Post the classification as a **reply on the review thread** (required by the `merge-gate` check):

```text
VALIDITY: confirmed
ACTION: must-fix
FIX: <sha>
```

Then resolve the thread. Rubber-stamp resolves without this reply fail CI.

---

## 20. Fixing verified comments

Prefer the same child/owner who wrote the affected code.

If continuation is available, resume that child rather than spawning a blind replacement.

Fix prompt:

```text
The following review finding was independently VERIFIED.

Finding:
<exact finding>

Evidence:
<evidence>

Fix ONLY this issue.
Add or update a regression test.
Do not change unrelated files.
Do not push.
Create a focused local commit.
Return commit SHA + exact test results.
```

Parent then inspects and cherry-picks.

---

## 21. Resolving comments

Resolve only when:

### Valid code issue

- fix committed;
- targeted regression test passes;
- full CI passes;
- fresh reviewer/verifier confirms.

### Invalid/unsupported comment

Reply with evidence explaining why no change was made, then resolve after parent decision.

### Out-of-scope comment

Record a follow-up issue/task if useful, link it, then resolve.

---

## 22. Fresh review after fixes

Never do:

```text
approved
→ fix comments
→ merge immediately
```

Always:

```text
review-fix commits
→ inspect full origin/main...HEAD diff
→ CI again
→ fresh independent review
→ resolve remaining conversations
→ merge
```

---

## 23. Gate closure

Only the parent closes gates.

Gate evidence must be based on actual executed checks, not presence of files.

Recommended final gate commit:

```text
docs(c2): record Gate C2 evidence
```

A gate should record:

- commands run;
- PASS/FAIL;
- relevant environment;
- test counts if applicable;
- isolation evidence;
- known limitations;
- commit SHA.

Do not close `PHASES.md` from a child worktree.

---

## 24. Phase 2 recommended fan-out

For the current DockerDev phase:

```text
                         PARENT / INTEGRATOR
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
          v                       v                       v
     Explorer A               Builder A               Builder B
     read-only                worktree                worktree
          |                       |                       |
 audit provider contract     DockerDevProvider      C2 integration tests
 + C1 behavior               + dev image            isolation/persistence
          |                       |                       |
          +--------------+--------+---------+-------------+
                         |
                         v
                  PARENT INTEGRATION
                         |
                         v
                  FULL LOCAL VERIFY
                         |
                         v
                 READ-ONLY REVIEWERS
                         |
                         v
                 VERIFY REVIEW FINDINGS
                         |
                         v
                  FIX VALID FINDINGS
                         |
                         v
                    CI + RE-REVIEW
                         |
                         v
                   Gate C2 evidence
```

Do not rewrite FakeProvider unless C2 reveals a confirmed contract defect.

---

## 25. Optional Grok Build workflows

After the manual process is proven, create reusable read-only workflows under `.grok/workflows/` for:

### `phase-review`

Fan out:

- correctness reviewer;
- security reviewer;
- test reviewer;
- scope reviewer;

then independently verify findings and return one consolidated report.

It must not commit, push, resolve comments, close gates, or merge.

### `gate-check`

- read current gate;
- run required verification;
- verify forbidden-scope rules;
- verify Floks-main isolation;
- return PASS/FAIL + evidence.

It must not close the gate itself.

---

## 26. Final merge checklist

Before merging:

- feature branch is not `main`;
- branch is current with `main`;
- full `npm run verify` is green;
- current-phase integration tests are green;
- required CI is green;
- no secret/provider credential leaked;
- no Floks-main changes;
- no future-phase implementation;
- hard Nexus/graph flags remain false before G0;
- all review comments were individually verified;
- all valid findings were fixed;
- fixes have regression tests where applicable;
- fresh review after fixes is complete;
- all conversations are resolved;
- explicit merge approval has been given.

Then squash merge to `main`.

---

## 27. Core principle

Use parallel agents for **speed of independent analysis and implementation**, but preserve exactly one integration authority.

```text
builders → local commits only
parent   → integration + branch push + PR
reviewers → findings only
verifier → validates findings
fixers → focused local fix commits
parent/human → final merge decision
```

Parallel execution must never weaken sequential phase gates, repository isolation, evidence requirements, or merge control.
