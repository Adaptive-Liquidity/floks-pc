import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consistencyError,
  evaluateThread,
  evaluateThreads,
  lastClassification,
  parseClassification,
  type ReviewThread,
} from "../../scripts/merge-gate.ts";

function thread(partial: Partial<ReviewThread> & { comments: ReviewThread["comments"] }): ReviewThread {
  return {
    id: partial.id ?? "t1",
    path: partial.path ?? "src/example.ts",
    isResolved: partial.isResolved ?? false,
    isOutdated: partial.isOutdated ?? false,
    comments: partial.comments,
  };
}

describe("parseClassification", () => {
  it("parses inline VALIDITY/ACTION/FIX", () => {
    const c = parseClassification(
      "looks real\nVALIDITY: confirmed\nACTION: must-fix\nFIX: abcdef0\n",
    );
    assert.deepEqual(c, { validity: "confirmed", action: "must-fix", fix: "abcdef0" });
  });

  it("parses the operating-instructions block form and aliases", () => {
    const c = parseClassification(
      ["VALIDITY", "partially confirmed", "ACTION", "must fix", "FIX", "none"].join("\n"),
    );
    assert.deepEqual(c, {
      validity: "partially-confirmed",
      action: "must-fix",
      fix: "none",
    });
  });

  it("accepts unsupported + no code change", () => {
    const c = parseClassification("VALIDITY: unsupported\nACTION: no code change\n");
    assert.equal(c?.validity, "unsupported");
    assert.equal(c?.action, "no-change");
    assert.equal(c?.fix, undefined);
  });

  it("returns null when VALIDITY or ACTION is missing", () => {
    assert.equal(parseClassification("ACTION: must-fix\n"), null);
    assert.equal(parseClassification("just a comment"), null);
  });

  it("returns null for a malformed FIX", () => {
    assert.equal(parseClassification("VALIDITY: confirmed\nACTION: must-fix\nFIX: not-a-sha\n"), null);
  });
});

describe("lastClassification", () => {
  it("ignores a classification on the original review comment", () => {
    const found = lastClassification(
      thread({
        comments: [
          { author: "copilot", body: "VALIDITY: confirmed\nACTION: must-fix\nFIX: abcdef0" },
        ],
      }),
    );
    assert.equal(found, null);
  });

  it("uses the latest reply that parses", () => {
    const found = lastClassification(
      thread({
        comments: [
          { author: "copilot", body: "bug here" },
          { author: "agent", body: "VALIDITY: confirmed\nACTION: must-fix\nFIX: 1111111" },
          { author: "agent", body: "VALIDITY: unsupported\nACTION: no-change" },
        ],
      }),
    );
    assert.equal(found?.validity, "unsupported");
    assert.equal(found?.action, "no-change");
  });
});

describe("consistencyError", () => {
  it("allows confirmed + must-fix", () => {
    assert.equal(
      consistencyError({ validity: "confirmed", action: "must-fix", fix: "abcdef0" }),
      undefined,
    );
  });

  it("rejects confirmed + no-change", () => {
    assert.match(
      consistencyError({ validity: "confirmed", action: "no-change", fix: undefined }) ?? "",
      /no-change/,
    );
  });

  it("rejects unsupported + must-fix", () => {
    assert.match(
      consistencyError({ validity: "unsupported", action: "must-fix", fix: "abcdef0" }) ?? "",
      /unsupported/,
    );
  });
});

describe("evaluateThread", () => {
  it("fails when there is no reply classification", () => {
    const v = evaluateThread(
      thread({
        comments: [{ author: "reviewer", body: "this is broken" }],
      }),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /no merge-gate classification/);
  });

  it("fails confirmed must-fix without FIX sha", () => {
    const v = evaluateThread(
      thread({
        isResolved: true,
        comments: [
          { author: "reviewer", body: "null deref" },
          { author: "agent", body: "VALIDITY: confirmed\nACTION: must-fix" },
        ],
      }),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /FIX/);
  });

  it("fails when FIX is not an ancestor of HEAD", () => {
    const v = evaluateThread(
      thread({
        isResolved: true,
        comments: [
          { author: "reviewer", body: "null deref" },
          {
            author: "agent",
            body: "VALIDITY: confirmed\nACTION: must-fix\nFIX: deadbeef",
          },
        ],
      }),
      { headSha: "cafebabe", isAncestor: () => false },
    );
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /not an ancestor/);
  });

  it("fails classified but unresolved threads", () => {
    const v = evaluateThread(
      thread({
        isResolved: false,
        comments: [
          { author: "reviewer", body: "typo" },
          { author: "agent", body: "VALIDITY: unsupported\nACTION: no-change" },
        ],
      }),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /unresolved/);
  });

  it("passes a fixed confirmed finding that is resolved", () => {
    const v = evaluateThread(
      thread({
        isResolved: true,
        comments: [
          { author: "reviewer", body: "null deref" },
          {
            author: "agent",
            body: "VALIDITY: confirmed\nACTION: must-fix\nFIX: abcdef0\nEVIDENCE\n- src/x.ts:10\n",
          },
        ],
      }),
      { headSha: "cafebabe", isAncestor: (fix, head) => fix === "abcdef0" && head === "cafebabe" },
    );
    assert.equal(v.ok, true);
  });

  it("passes an unsupported comment after a no-change reply and resolve", () => {
    const v = evaluateThread(
      thread({
        isResolved: true,
        comments: [
          { author: "reviewer", body: "please rewrite the world" },
          { author: "agent", body: "VALIDITY: out-of-scope\nACTION: defer" },
        ],
      }),
    );
    assert.equal(v.ok, true);
  });
});

describe("evaluateThreads", () => {
  it("passes when there are no threads", () => {
    const result = evaluateThreads([]);
    assert.equal(result.ok, true);
    assert.equal(result.verdicts.length, 0);
  });

  it("fails the gate if any thread fails", () => {
    const good = thread({
      id: "ok",
      isResolved: true,
      comments: [
        { author: "r", body: "nit" },
        { author: "a", body: "VALIDITY: stale\nACTION: no-change" },
      ],
    });
    const bad = thread({
      id: "bad",
      comments: [{ author: "r", body: "real bug" }],
    });
    const result = evaluateThreads([good, bad]);
    assert.equal(result.ok, false);
    assert.equal(result.verdicts.filter((v) => !v.ok).length, 1);
  });
});
