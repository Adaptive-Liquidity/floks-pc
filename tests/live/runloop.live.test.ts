/**
 * Opt-in live Runloop suite alias.
 * Cases live in tests/providers/runloop.isolation.test.ts.
 */

import { describe, it } from "node:test";

const LIVE = process.env.FLOK_LIVE_RUNLOOP_TEST === "1";

describe("live Runloop entry (see tests/providers/runloop.isolation.test.ts)", { skip: !LIVE }, () => {
  it("is covered by runloop.isolation.test.ts live describe", () => {
    // real cases are in tests/providers/runloop.isolation.test.ts
  });
});
