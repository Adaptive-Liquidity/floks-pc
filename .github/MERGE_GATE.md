# Merge gate

PRs into `main` cannot merge until:

1. Required GitHub Actions checks are green:
   - `typecheck + tests + build`
   - `live docker isolation`
   - `merge-gate`
2. Every review **thread** has a classification **reply** (not only the original comment).
3. Confirmed / partially-confirmed findings that must or should be fixed cite a `FIX` commit that is on the PR branch.
4. Every review thread is **resolved**.
5. The branch is up to date with `main`.
6. Merge method is **squash**.

Paid Runloop live tests are **not** required.

This file is the machine protocol. Human process lives in `FLOKS_PC_BUILD_OPERATING_INSTRUCTIONS.md` §§16–21.

## Classification reply

Reply on the thread (a new comment, not an edit of the reviewer's first note):

```text
VALIDITY: confirmed
ACTION: must-fix
FIX: abcdef0

EVIDENCE
- path/to/file.ts:12
- AGENTS.md / AUTHORITY.md / PHASES.md rule that applies
- test or reproduction
```

Aliases accepted:

| Field | Allowed values |
| --- | --- |
| `VALIDITY` | `confirmed`, `partially-confirmed`, `unsupported`, `stale`, `question`, `out-of-scope` |
| `ACTION` | `must-fix`, `should-fix`, `no-change`, `defer` |
| `FIX` | 7–40 hex SHA, or `none` |

Block form from the operating instructions also works:

```text
VALIDITY
unsupported
ACTION
no code change
```

## Consistency

- `confirmed` / `partially-confirmed` + `must-fix` / `should-fix` → **required** `FIX: <sha>` that is an ancestor of the PR head. Then resolve the thread.
- `confirmed` / `partially-confirmed` + `defer` → no code change in this PR; still reply and resolve (and file a follow-up if needed).
- `confirmed` + `no-change` is **rejected** (that is a confirmed bug you chose to ignore).
- `unsupported` / `stale` / `question` / `out-of-scope` → `no-change` or `defer`, then resolve. Do not claim a fix.

Do not rubber-stamp. Classify first. Fix only confirmed / partially-confirmed actionable findings.

## Repository ruleset

The JSON at `.github/rulesets/main-protection.json` is the intended GitHub ruleset for `main`. Applying it needs Administration on the repo (a default `GITHUB_TOKEN` cannot). After this PR is on `main`:

```bash
GH_ADMIN_TOKEN=... npm run protect:main
```

Until that command succeeds, GitHub will not *enforce* the ruleset; `merge-gate` still runs on PRs and fails the check when threads are unclassified.

Do not require a human approving review while only one human GitHub identity exists.
