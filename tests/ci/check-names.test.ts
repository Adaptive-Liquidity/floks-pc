import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("does not double-subscribe merge-gate to review and review_comment", () => {
    const mergeGate = readFileSync(
      join(ROOT, ".github/workflows/merge-gate.yml"),
      "utf8",
    );
    assert.match(mergeGate, /^ {2}pull_request_review:$/m);
    assert.doesNotMatch(
      mergeGate,
      /^ {2}pull_request_review_comment:$/m,
      "pull_request_review already fires for inline comments; a second trigger duplicates the required check and cancel-in-progress leaves it cancelled",
    );
  });
});
