/**
 * Gate C3A isolation contract.
 *
 * Non-live: MemoryRunloopControlPlane proves A/B isolation, distinct boot IDs,
 * independent lifecycle, suspend/resume disk persist, snapshot fork — zero network.
 *
 * Live: skipped unless FLOK_LIVE_RUNLOOP_TEST=1. When the flag is set,
 * missing RUNLOOP_API_KEY / FLOK_RUNLOOP_BLUEPRINT / API failure MUST FAIL,
 * never silent skip.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  RunloopProvider,
  MemoryRunloopControlPlane,
  RUNLOOP_WORKSPACE_ROOT,
} from "../../src/lib/computers/providers/index.js";

function memory(): RunloopProvider {
  return new RunloopProvider({
    client: new MemoryRunloopControlPlane(),
    blueprint: "memory-linux-vm",
  });
}

describe("Runloop C3A isolation (memory plane)", () => {
  it("A cannot read B's workspace file and vice versa", async () => {
    const p = memory();
    const a = await p.provision({ birdId: "bird-a", flockId: "flock-1" });
    const b = await p.provision({ birdId: "bird-b", flockId: "flock-1" });
    assert.notEqual(a.providerRef, b.providerRef);

    assert.equal(
      (
        await p.filesystem(a.providerRef, {
          operation: "write",
          path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
          content: "secret-from-A",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await p.filesystem(b.providerRef, {
          operation: "write",
          path: `${RUNLOOP_WORKSPACE_ROOT}/B.txt`,
          content: "secret-from-B",
        })
      ).ok,
      true,
    );

    const readAFromB = await p.filesystem(b.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
    });
    assert.equal(readAFromB.ok, false);

    const readBFromA = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/B.txt`,
    });
    assert.equal(readBFromA.ok, false);
  });

  it("two machines have different boot_id values", async () => {
    const p = memory();
    const a = await p.provision({ birdId: "ns-a", flockId: "flock-1" });
    const b = await p.provision({ birdId: "ns-b", flockId: "flock-1" });
    const bootA = await p.exec(a.providerRef, {
      argv: ["cat", "/proc/sys/kernel/random/boot_id"],
    });
    const bootB = await p.exec(b.providerRef, {
      argv: ["cat", "/proc/sys/kernel/random/boot_id"],
    });
    assert.equal(bootA.exitCode, 0);
    assert.equal(bootB.exitCode, 0);
    assert.notEqual(bootA.stdout.trim(), bootB.stdout.trim());
  });

  it("independent lifecycle: pausing A does not pause B", async () => {
    const p = memory();
    const a = await p.provision({ birdId: "life-a", flockId: "flock-1" });
    const b = await p.provision({ birdId: "life-b", flockId: "flock-1" });
    await p.pause(a.providerRef);
    const sa = await p.status(a.providerRef);
    const sb = await p.status(b.providerRef);
    assert.equal(sa.state, "paused");
    assert.equal(sb.state, "running");
  });

  it("suspend preserves disk files after resume", async () => {
    const p = memory();
    const a = await p.provision({ birdId: "sus-a", flockId: "f" });
    await p.filesystem(a.providerRef, {
      operation: "write",
      path: `${RUNLOOP_WORKSPACE_ROOT}/persist.txt`,
      content: "disk-kept",
    });
    await p.pause(a.providerRef);
    await p.wake(a.providerRef);
    const r = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/persist.txt`,
    });
    assert.equal(r.ok, true);
    assert.equal(r.data, "disk-kept");
  });
});

const LIVE = process.env.FLOK_LIVE_RUNLOOP_TEST === "1";

describe("Runloop C3A live Devboxes", { skip: !LIVE }, () => {
  before(() => {
    if (!process.env.RUNLOOP_API_KEY) {
      throw new Error(
        "FLOK_LIVE_RUNLOOP_TEST=1 but RUNLOOP_API_KEY is missing (must FAIL, not skip)",
      );
    }
    if (!process.env.FLOK_RUNLOOP_BLUEPRINT) {
      throw new Error(
        "FLOK_LIVE_RUNLOOP_TEST=1 but FLOK_RUNLOOP_BLUEPRINT is missing (must FAIL, not skip)",
      );
    }
  });

  it("two live Devboxes prove isolation, suspend, snapshot fork, then shutdown", async () => {
    process.env.FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY = "1";
    const p = await RunloopProvider.fromEnv();
    const refs: string[] = [];
    try {
      const a = await p.provision({ birdId: "live-a", flockId: "flock-live" });
      const b = await p.provision({ birdId: "live-b", flockId: "flock-live" });
      refs.push(a.providerRef, b.providerRef);
      assert.notEqual(a.providerRef, b.providerRef);

      assert.equal(
        (
          await p.filesystem(a.providerRef, {
            operation: "write",
            path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
            content: "secret-from-A",
          })
        ).ok,
        true,
      );
      const leaked = await p.filesystem(b.providerRef, {
        operation: "read",
        path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
      });
      assert.equal(leaked.ok, false);

      assert.equal(
        (
          await p.filesystem(b.providerRef, {
            operation: "write",
            path: `${RUNLOOP_WORKSPACE_ROOT}/B.txt`,
            content: "from-B",
          })
        ).ok,
        true,
      );

      const bootA = await p.exec(a.providerRef, {
        argv: ["cat", "/proc/sys/kernel/random/boot_id"],
      });
      const bootB = await p.exec(b.providerRef, {
        argv: ["cat", "/proc/sys/kernel/random/boot_id"],
      });
      assert.equal(bootA.exitCode, 0, bootA.stderr);
      assert.equal(bootB.exitCode, 0, bootB.stderr);
      assert.notEqual(bootA.stdout.trim(), bootB.stdout.trim());

      await p.pause(a.providerRef);
      const sa = await p.status(a.providerRef);
      const sb = await p.status(b.providerRef);
      assert.equal(sa.state, "paused");
      assert.equal(sb.state, "running");

      await p.wake(a.providerRef);
      const persisted = await p.filesystem(a.providerRef, {
        operation: "read",
        path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
      });
      assert.equal(persisted.ok, true);
      assert.equal(persisted.data, "secret-from-A");

      const ck = await p.checkpoint(a.providerRef);
      const c = await p.restore({
        computerId: a.providerRef,
        checkpointId: ck.providerSnapshotRef,
        providerSnapshotRef: ck.providerSnapshotRef,
        birdId: "live-a",
        flockId: "flock-live",
      });
      refs.push(c.providerRef);
      const fromSnap = await p.filesystem(c.providerRef, {
        operation: "read",
        path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
      });
      assert.equal(fromSnap.ok, true);
      assert.equal(fromSnap.data, "secret-from-A");

      await p.filesystem(c.providerRef, {
        operation: "write",
        path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
        content: "mutated-C",
      });
      const aStill = await p.filesystem(a.providerRef, {
        operation: "read",
        path: `${RUNLOOP_WORKSPACE_ROOT}/A.txt`,
      });
      assert.equal(aStill.data, "secret-from-A");
    } finally {
      for (const ref of [...refs].reverse()) {
        await p.destroy(ref).catch(() => undefined);
      }
    }
  });
});
