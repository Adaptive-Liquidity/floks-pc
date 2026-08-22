/**
 * Gate C3 isolation contract.
 *
 * Non-live: MemoryDaytonaControlPlane proves A/B isolation, distinct boot IDs,
 * distinct browser profiles, independent lifecycle — zero network.
 *
 * Live: skipped unless FLOK_LIVE_DAYTONA_TEST=1 (or FLOK_LIVE_COMPUTER_TEST=1).
 * When a live flag is set, missing DAYTONA_API_KEY / FLOK_DAYTONA_SNAPSHOT
 * or API failure MUST FAIL, never silent skip.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  DaytonaProvider,
  MemoryDaytonaControlPlane,
  DAYTONA_WORKSPACE_ROOT,
} from "../../src/lib/computers/providers/index.js";

describe("Daytona C3 isolation (memory plane)", () => {
  it("A cannot read B's workspace file and vice versa", async () => {
    const p = new DaytonaProvider({
      client: new MemoryDaytonaControlPlane(),
      snapshot: "memory-linux-vm",
    });
    const a = await p.provision({ birdId: "bird-a", flockId: "flock-1" });
    const b = await p.provision({ birdId: "bird-b", flockId: "flock-1" });
    assert.notEqual(a.providerRef, b.providerRef);

    assert.equal(
      (
        await p.filesystem(a.providerRef, {
          operation: "write",
          path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
          content: "secret-from-A",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await p.filesystem(b.providerRef, {
          operation: "write",
          path: `${DAYTONA_WORKSPACE_ROOT}/B.txt`,
          content: "secret-from-B",
        })
      ).ok,
      true,
    );

    const readAFromB = await p.filesystem(b.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
    });
    assert.equal(readAFromB.ok, false);

    const readBFromA = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/B.txt`,
    });
    assert.equal(readBFromA.ok, false);

    const own = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
    });
    assert.equal(own.ok, true);
    assert.equal(own.data, "secret-from-A");
  });

  it("two machines have different process-namespace and browser-profile markers", async () => {
    const p = new DaytonaProvider({
      client: new MemoryDaytonaControlPlane(),
      snapshot: "memory-linux-vm",
    });
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

    const profileA = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/.flok-browser-profile/id`,
    });
    const profileB = await p.filesystem(b.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/.flok-browser-profile/id`,
    });
    assert.equal(profileA.ok, true);
    assert.equal(profileB.ok, true);
    assert.notEqual(profileA.data, profileB.data);
  });

  it("independent lifecycle: stopping A does not stop B", async () => {
    const p = new DaytonaProvider({
      client: new MemoryDaytonaControlPlane(),
      snapshot: "memory-linux-vm",
    });
    const a = await p.provision({ birdId: "life-a", flockId: "flock-1" });
    const b = await p.provision({ birdId: "life-b", flockId: "flock-1" });
    await p.stop(a.providerRef);
    const sa = await p.status(a.providerRef);
    const sb = await p.status(b.providerRef);
    assert.equal(sa.state, "stopped");
    assert.equal(sb.state, "running");

    await p.filesystem(b.providerRef, {
      operation: "write",
      path: `${DAYTONA_WORKSPACE_ROOT}/still.txt`,
      content: "b-alive",
    });
    const still = await p.filesystem(b.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/still.txt`,
    });
    assert.equal(still.ok, true);
    assert.equal(still.data, "b-alive");
  });
});

const LIVE =
  process.env.FLOK_LIVE_DAYTONA_TEST === "1" ||
  process.env.FLOK_LIVE_COMPUTER_TEST === "1";

describe("Daytona C3 live Linux VMs", { skip: !LIVE }, () => {
  before(() => {
    if (!process.env.DAYTONA_API_KEY) {
      throw new Error(
        "live Daytona flag is set but DAYTONA_API_KEY is missing (must FAIL, not skip)",
      );
    }
    if (!process.env.FLOK_DAYTONA_SNAPSHOT) {
      throw new Error(
        "live Daytona flag is set but FLOK_DAYTONA_SNAPSHOT is missing — Linux VM snapshot required (must FAIL, not skip)",
      );
    }
  });

  it("two live VMs have distinct ids, filesystems, and lifecycle", async () => {
    const p = await DaytonaProvider.fromEnv();
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
            path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
            content: "secret-from-A",
          })
        ).ok,
        true,
      );
      const leaked = await p.filesystem(b.providerRef, {
        operation: "read",
        path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
      });
      assert.equal(leaked.ok, false);

      const bootA = await p.exec(a.providerRef, {
        argv: ["cat", "/proc/sys/kernel/random/boot_id"],
      });
      const bootB = await p.exec(b.providerRef, {
        argv: ["cat", "/proc/sys/kernel/random/boot_id"],
      });
      assert.equal(bootA.exitCode, 0, bootA.stderr);
      assert.equal(bootB.exitCode, 0, bootB.stderr);
      assert.notEqual(bootA.stdout.trim(), bootB.stdout.trim());

      await p.stop(a.providerRef);
      const sa = await p.status(a.providerRef);
      const sb = await p.status(b.providerRef);
      assert.equal(sa.state, "stopped");
      assert.notEqual(sb.state, "stopped");
    } finally {
      for (const ref of refs) {
        await p.destroy(ref).catch(() => undefined);
      }
    }
  });
});
