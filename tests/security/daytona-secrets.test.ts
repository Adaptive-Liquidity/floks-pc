/**
 * C3 secret invariant: DAYTONA_API_KEY never enters a Node.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DaytonaProvider,
  MemoryDaytonaControlPlane,
  assertNoControlPlaneSecrets,
} from "../../src/lib/computers/providers/index.js";

describe("Daytona secret isolation", () => {
  it("provision envVars object does not contain DAYTONA_API_KEY", async () => {
    const prev = process.env.DAYTONA_API_KEY;
    process.env.DAYTONA_API_KEY = "control-plane-secret-value";
    try {
      const p = new DaytonaProvider({
        client: new MemoryDaytonaControlPlane(),
        snapshot: "memory-linux-vm",
      });
      const a = await p.provision({ birdId: "sec", flockId: "f" });
      const leaked = await p.exec(a.providerRef, {
        argv: ["printenv", "DAYTONA_API_KEY"],
      });
      assert.equal(leaked.exitCode, 0);
      assert.equal(leaked.stdout, "");
    } finally {
      if (prev === undefined) delete process.env.DAYTONA_API_KEY;
      else process.env.DAYTONA_API_KEY = prev;
    }
  });

  it("assertNoControlPlaneSecrets rejects JWT too", () => {
    assert.throws(() =>
      assertNoControlPlaneSecrets({ DAYTONA_JWT_TOKEN: "nope" }),
    );
  });
});
