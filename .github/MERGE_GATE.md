# Merge gate

**GitHub enforces branch protection. GitHub Actions runs the named jobs. `merge-gate` enforces the review-classification protocol. Cursor only edits code/workflows and can reply when a check or review fails. The ruleset does not start Cursor, and it does not run tests.**

| Requirement | Enforced by GitHub ruleset? | Enforced by `merge-gate` job? |
| --- | ---: | ---: |
| PR required before merging to `main` | Yes | No |
| Branch must be up to date with `main` | Yes, via strict status checks | No |
| Required checks green | Yes | The check itself must run |
| Squash-only merge | Yes | No |
| Every review thread resolved | Optional (ruleset; currently off) | Only if `MERGE_GATE_REQUIRE_RESOLVED=true` |
| Every thread has a classification reply | No | Yes |
| Confirmed finding has `FIX` SHA | No | Yes |
| `FIX` SHA is on the PR branch | No | Yes |
| Paid Runloop tests not required | No | Yes, by not checking for them |

The ruleset JSON is only JSON: `.github/rulesets/main-protection.json`. It uses GitHub REST property names (`required_approving_review_count`, `strict_required_status_checks_policy`, `integration_id`, `allowed_merge_methods`). Do not paste Markdown into that file.

GitHub blocks merge to `main` unless these **GitHub Actions check names** are green on the head commit. Those names must match the job `name:` fields exactly:

```text
verify      — code typechecks, tests pass, it builds
docker-c2   — Docker isolation test passes
merge-gate  — security/policy scripts pass
```

Conversation resolution is **off** on the live ruleset (`required_review_thread_resolution: false`). Unresolved threads do not block merge by themselves.

Those jobs are defined in `.github/workflows/verify.yml` and `.github/workflows/merge-gate.yml`. GitHub-hosted runners execute them. Paid Runloop workflows are not required checks. The ruleset pins those checks to GitHub Actions via `integration_id` `15368`.

`merge-gate.yml` listens to `pull_request` (opened, synchronize, reopened, ready_for_review) and `workflow_dispatch` only. Do not add `pull_request_review` or `pull_request_review_comment`: Gitar auto-approve and inline classification replies each start another run. `cancel-in-progress: true` then leaves a cancelled required `merge-gate` check and GitHub blocks merge. After posting classification replies, push a commit or re-run `merge-gate` (`workflow_dispatch` with the PR number). `cancel-in-progress` is **false** so a required check is never left cancelled.

## What must be true before merge

1. The three unpaid GitHub Actions checks above are green.
2. Every review **thread** has a classification **reply** (not only the original comment).
3. Confirmed / partially-confirmed findings that must or should be fixed cite a `FIX` commit that is an ancestor of the PR head.
4. The branch is up to date with `main` (ruleset `strict_required_status_checks_policy`).
5. Merge method is **squash** (ruleset `allowed_merge_methods`).

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

## Applying the GitHub ruleset

Applying `.github/rulesets/main-protection.json` needs Administration on the repo (a default `GITHUB_TOKEN` cannot). After this PR is on `main`:

```bash
GH_ADMIN_TOKEN=... npm run protect:main
```

That call hits GitHub's repository rulesets API. It does not invoke Cursor. Until it succeeds, GitHub will not *enforce* the ruleset; the `merge-gate` Actions job still runs on PRs and fails when threads are unclassified.

Do not require a human approving review while only one human GitHub identity exists.
