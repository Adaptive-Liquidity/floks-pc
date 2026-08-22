/**
 * State machine unit tests — zero provider calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  assertTransition,
  nextStates,
  isTerminal,
  LEGAL_TRANSITIONS,
  IllegalStateTransition,
} from "../../src/lib/computers/index.js";
import type { ComputerState } from "../../src/lib/computers/index.js";

const ALL_STATES: ComputerState[] = [
  "requested",
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopped",
  "recovering",
  "error",
  "deleting",
  "deleted",
];

describe("state machine", () => {
  it("allows every entry in LEGAL_TRANSITIONS", () => {
    for (const from of ALL_STATES) {
      for (const to of LEGAL_TRANSITIONS[from]) {
        assert.equal(canTransition(from, to), true, `${from} → ${to}`);
        assert.doesNotThrow(() => assertTransition(from, to));
      }
    }
  });

  it("rejects every pair not in LEGAL_TRANSITIONS", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (!LEGAL_TRANSITIONS[from].includes(to)) {
          assert.equal(canTransition(from, to), false, `${from} ↛ ${to}`);
          assert.throws(
            () => assertTransition(from, to),
            (err: unknown) => err instanceof IllegalStateTransition,
          );
        }
      }
    }
  });

  it("deleted is terminal", () => {
    assert.equal(isTerminal("deleted"), true);
    assert.equal(nextStates("deleted").length, 0);
    assert.equal(canTransition("deleted", "ready"), false);
  });

  it("requested can only go to provisioning, error, or deleting", () => {
    assert.deepEqual(
      [...nextStates("requested")].sort(),
      ["deleting", "error", "provisioning"].sort(),
    );
  });
});
