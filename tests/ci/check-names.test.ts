import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function yamlJobName(yaml: string, jobId: string): string | null {
  const block = yaml.match(
    new RegExp(`(?:^|\\n)  ${jobId}:\\n((?:    .*\\n)+)`),
  );
  if (!block) return null;
  const name = block[1].match(/^\s+name:\s*(.+)\s*$/m);
  return name ? name[1].trim() : null;
}

describe("required status check names", () => {
  it("match GitHub Actions job names used as check contexts", () => {
    const ruleset = JSON.parse(
      readFileSync(join(ROOT, ".github/rulesets/main-protection.json"), "utf8"),
    ) as {
      rules: Array<{
        type: string;
        parameters?: {
          required_status_checks?: Array<{ context: string; integration_id?: number }>;
        };
      }>;
    };
    const verify = readFileSync(join(ROOT, ".github/workflows/verify.yml"), "utf8");
    const mergeGate = readFileSync(
      join(ROOT, ".github/workflows/merge-gate.yml"),
      "utf8",
    );

    const checks = ruleset.rules.find(
      (rule) => rule.type === "required_status_checks",
    )?.parameters?.required_status_checks;

    assert.deepEqual(
      checks?.map((check) => check.context),
      [
        "verify",
        "docker-c2",
        "merge-gate",
      ],
    );
    assert.ok(
      checks?.every((check) => check.integration_id === 15368),
      "required checks must come from GitHub Actions (integration_id 15368)",
    );
    assert.equal(yamlJobName(verify, "verify"), "verify");
    assert.equal(yamlJobName(verify, "docker-c2"), "docker-c2");
    assert.equal(yamlJobName(mergeGate, "merge-gate"), "merge-gate");
  });

  it("does not retrigger merge-gate on review events", () => {
    const mergeGate = readFileSync(
      join(ROOT, ".github/workflows/merge-gate.yml"),
      "utf8",
    );
    assert.match(mergeGate, /^ {2}pull_request:$/m);
    assert.match(mergeGate, /^ {2}workflow_dispatch:$/m);
    assert.doesNotMatch(
      mergeGate,
      /^ {2}pull_request_review:$/m,
      "Gitar auto-approve and classification replies emit pull_request_review; a second run cancels the required check",
    );
    assert.doesNotMatch(
      mergeGate,
      /^ {2}pull_request_review_comment:$/m,
      "inline comments already duplicate pull_request_review; do not subscribe to both",
    );
    assert.match(
      mergeGate,
      /cancel-in-progress:\s*false/,
      "cancelling in-progress merge-gate leaves a cancelled required check and blocks merge",
    );
  });

  it("registers a single Runloop workflow with phase selector", () => {
    const dir = join(ROOT, ".github/workflows");
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort();
    assert.deepEqual(files, ["merge-gate.yml", "runloop-c3.yml", "verify.yml"]);
    const runloop = readFileSync(join(dir, "runloop-c3.yml"), "utf8");
    assert.match(runloop, /^ {2}workflow_dispatch:$/m);
    assert.doesNotMatch(runloop, /^ {2}pull_request:$/m);
    assert.match(runloop, /^ {10}- c3a$/m);
    assert.match(runloop, /^ {10}- c3b-blueprint$/m);
    assert.match(runloop, /^ {10}- c3b-live$/m);
  });
});
