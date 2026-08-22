/**
 * Opt-in live Daytona suite alias.
 * The live cases live in tests/providers/daytona.isolation.test.ts so
 * `npm run test:live:daytona` can target them. This file stays empty-on-purpose
 * except for documenting the flag; node:test would fail on a zero-test file
 * if we registered nothing, so we expose a skip-unless-flag placeholder.
 */
import { describe, it } from "node:test";

const LIVE =
  process.env.FLOK_LIVE_DAYTONA_TEST === "1" ||
  process.env.FLOK_LIVE_COMPUTER_TEST === "1";

describe("live Daytona entry (see tests/providers/daytona.isolation.test.ts)", { skip: !LIVE }, () => {
  it("is covered by daytona.isolation.test.ts live describe", () => {
    // Real live assertions run in the isolation file when the flag is set.
  });
});
