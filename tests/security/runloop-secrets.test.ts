/**
 * C3A secret invariant: RUNLOOP_API_KEY never enters a Node / Devbox.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RunloopProvider,
  MemoryRunloopControlPlane,
  assertNoControlPlaneSecrets,
} from "../../src/lib/computers/providers/index.js";

describe("Runloop secret isolation", () => {
  it("provision envVars object does not contain RUNLOOP_API_KEY", async () => {
    const prev = process.env.RUNLOOP_API_KEY;
    process.env.RUNLOOP_API_KEY = "control-plane-secret-value";
    try {
      const p = new RunloopProvider({
        client: new MemoryRunloopControlPlane(),
        blueprint: "memory-linux-vm",
      });
      const a = await p.provision({ birdId: "sec", flockId: "f" });
      const leaked = await p.exec(a.providerRef, {
        argv: ["printenv", "RUNLOOP_API_KEY"],
      });
      assert.equal(leaked.exitCode, 0);
      assert.equal(leaked.stdout, "");
    } finally {
      if (prev === undefined) delete process.env.RUNLOOP_API_KEY;
      else process.env.RUNLOOP_API_KEY = prev;
    }
  });

  it("assertNoControlPlaneSecrets rejects injecting the live key value", () => {
    const prev = process.env.RUNLOOP_API_KEY;
    process.env.RUNLOOP_API_KEY = "unique-control-plane-value-xyz";
    try {
      assert.throws(() =>
        assertNoControlPlaneSecrets({ SOMETHING: "unique-control-plane-value-xyz" }),
      );
    } finally {
      if (prev === undefined) delete process.env.RUNLOOP_API_KEY;
      else process.env.RUNLOOP_API_KEY = prev;
    }
  });
});
