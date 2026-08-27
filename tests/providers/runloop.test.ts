/**
 * RunloopProvider — non-live tests. Zero network / zero Runloop API.
 * Injected MemoryRunloopControlPlane only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerService,
  RunloopProvider,
  RunloopBlueprintRequired,
  ComputerUseNotAvailable,
  MemoryRunloopControlPlane,
  FLAGS,
  assertNexusDisabled,
  ProviderUnavailable,
} from "../../src/lib/computers/index.js";
import {
  assertNoControlPlaneSecrets,
  CONTROL_PLANE_SECRET_ENV_KEYS,
  RUNLOOP_WORKSPACE_ROOT,
  isIdempotentShutdownError,
} from "../../src/lib/computers/providers/index.js";
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
} from "../../src/lib/computers/providers/runloop-interactive.js";

function provider(): RunloopProvider {
  return new RunloopProvider({
    client: new MemoryRunloopControlPlane(),
    blueprint: "memory-linux-vm",
  });
}

describe("RunloopProvider (no network)", () => {
  it("reports provider name runloop", () => {
    assert.equal(provider().name, "runloop");
  });

  it("treats only terminal missing-resource shutdown errors as idempotent", () => {
    assert.equal(isIdempotentShutdownError(new Error("devbox already shutdown")), true);
    assert.equal(isIdempotentShutdownError(new Error("devbox not found")), true);
    assert.equal(isIdempotentShutdownError(new Error("resource deleted")), true);
    assert.equal(isIdempotentShutdownError({ status: 404, message: "gone" }), true);
    assert.equal(isIdempotentShutdownError(new Error("shutdown request failed")), false);
    assert.equal(isIdempotentShutdownError(new Error("internal error")), false);
  });

  it("advertises honest C3B capabilities", () => {
    const caps = provider().capabilities();
    assert.equal(caps.linuxVm, true);
    assert.equal(caps.windowsVm, false);
    assert.equal(caps.pauseMemory, false);
    assert.equal(caps.snapshots, true);
    assert.equal(caps.forks, true);
    assert.equal(caps.customImages, true);
    assert.equal(caps.networkPolicy, true);
    assert.equal(caps.computerUse, true);
    assert.equal(caps.vnc, false);
    assert.equal(caps.accessibility, false);
  });

  it("hard-locks Nexus / graph flags", () => {
    assert.equal(FLAGS.FLOK_NEXUS_IQ_ENABLED, false);
    assert.equal(FLAGS.FLOK_GRAPH_MEMORY_ENABLED, false);
    assertNexusDisabled();
  });

  it("rejects construction without RUNLOOP_API_KEY when no client is injected", () => {
    const prevKey = process.env.RUNLOOP_API_KEY;
    const prevBp = process.env.FLOK_RUNLOOP_BLUEPRINT;
    delete process.env.RUNLOOP_API_KEY;
    delete process.env.FLOK_RUNLOOP_BLUEPRINT;
    try {
      assert.throws(
        () => new RunloopProvider(),
        (err: unknown) =>
          err instanceof ProviderUnavailable && err.code === "PROVIDER_UNAVAILABLE",
      );
    } finally {
      if (prevKey === undefined) delete process.env.RUNLOOP_API_KEY;
      else process.env.RUNLOOP_API_KEY = prevKey;
      if (prevBp === undefined) delete process.env.FLOK_RUNLOOP_BLUEPRINT;
      else process.env.FLOK_RUNLOOP_BLUEPRINT = prevBp;
    }
  });

  it("rejects missing blueprint when key is present but client is not and blueprint empty", () => {
    const prevKey = process.env.RUNLOOP_API_KEY;
    const prevBp = process.env.FLOK_RUNLOOP_BLUEPRINT;
    process.env.RUNLOOP_API_KEY = "test-key-not-for-guest";
    process.env.FLOK_RUNLOOP_BLUEPRINT = "";
    try {
      assert.throws(
        () => new RunloopProvider({ blueprint: "" }),
        (err: unknown) =>
          err instanceof RunloopBlueprintRequired ||
          err instanceof ProviderUnavailable,
      );
    } finally {
      if (prevKey === undefined) delete process.env.RUNLOOP_API_KEY;
      else process.env.RUNLOOP_API_KEY = prevKey;
      if (prevBp === undefined) delete process.env.FLOK_RUNLOOP_BLUEPRINT;
      else process.env.FLOK_RUNLOOP_BLUEPRINT = prevBp;
    }
  });

  it("rejects windows osType", async () => {
    await assert.rejects(
      () => provider().provision({ birdId: "w", flockId: "f", osType: "windows" }),
      (err: unknown) => err instanceof ProviderUnavailable,
    );
  });

  it("ComputerService records provider runloop", async () => {
    const service = new ComputerService(provider());
    const c = await service.requestComputer({ birdId: "bird-1", flockId: "flock-1" });
    assert.equal(c.provider, "runloop");
    assert.ok(c.providerRef);
  });

  it("rejects shell mode", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "sh", flockId: "f" });
    const r = await p.exec(a.providerRef, { argv: ["echo", "hi"], mode: "shell" });
    assert.equal(r.exitCode, 126);
    assert.match(r.stderr, /shell mode not allowed/);
  });

  it("rejects empty argv", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "e", flockId: "f" });
    const r = await p.exec(a.providerRef, { argv: [] });
    assert.equal(r.exitCode, 2);
  });

  it("rejects invalid env keys and control-plane secrets in exec env", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "env", flockId: "f" });
    const badKey = await p.exec(a.providerRef, {
      argv: ["true"],
      env: { "BAD-KEY": "x" },
    });
    assert.equal(badKey.exitCode, 2);

    const secret = await p.exec(a.providerRef, {
      argv: ["true"],
      env: { RUNLOOP_API_KEY: "must-not-enter-guest" },
    });
    assert.equal(secret.exitCode, 126);
    assert.match(secret.stderr, /RUNLOOP_API_KEY/);
  });

  it("jails filesystem paths to /home/user/flok", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "jail", flockId: "f" });
    const escaped = await p.filesystem(a.providerRef, {
      operation: "read",
      path: "/etc/passwd",
    });
    assert.equal(escaped.ok, false);
    assert.equal(escaped.errorCode, "PATH_ESCAPE");

    const cwd = await p.exec(a.providerRef, {
      argv: ["true"],
      cwd: "/etc",
    });
    assert.equal(cwd.exitCode, 126);
    assert.match(cwd.stderr, /PATH_ESCAPE/);
  });

  it("writes and reads under /home/user/flok", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "rw", flockId: "f" });
    assert.equal(
      (
        await p.filesystem(a.providerRef, {
          operation: "write",
          path: `${RUNLOOP_WORKSPACE_ROOT}/hello.txt`,
          content: "hello-runloop",
        })
      ).ok,
      true,
    );
    const r = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/hello.txt`,
    });
    assert.equal(r.ok, true);
    assert.equal(r.data, "hello-runloop");
  });

  it("observe returns screenshot; takeover stays fail-closed", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "c3b", flockId: "f" });
    const obs = await p.observe(a.providerRef, { includeScreenshot: true });
    assert.equal(obs.screenWidth, DISPLAY_WIDTH);
    assert.equal(obs.screenHeight, DISPLAY_HEIGHT);
    assert.ok(obs.screenshotBase64 && obs.screenshotBase64.length > 10);
    await assert.rejects(
      () => p.takeover(a.providerRef),
      (err: unknown) => err instanceof ComputerUseNotAvailable,
    );
  });

  it("checkpoint + restore yields a new providerRef with persisted files", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "snap-a", flockId: "f" });
    await p.filesystem(a.providerRef, {
      operation: "write",
      path: `${RUNLOOP_WORKSPACE_ROOT}/kept.txt`,
      content: "from-a",
    });
    const ck = await p.checkpoint(a.providerRef);
    assert.ok(ck.providerSnapshotRef);
    const c = await p.restore({
      computerId: a.providerRef,
      checkpointId: ck.providerSnapshotRef,
      providerSnapshotRef: ck.providerSnapshotRef,
      birdId: "snap-a",
      flockId: "f",
    });
    assert.notEqual(c.providerRef, a.providerRef);
    const read = await p.filesystem(c.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/kept.txt`,
    });
    assert.equal(read.ok, true);
    assert.equal(read.data, "from-a");
    await p.filesystem(c.providerRef, {
      operation: "write",
      path: `${RUNLOOP_WORKSPACE_ROOT}/kept.txt`,
      content: "mutated-c",
    });
    const original = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/kept.txt`,
    });
    assert.equal(original.data, "from-a");
  });

  it("CONTROL_PLANE_SECRET_ENV_KEYS lists RUNLOOP_API_KEY", () => {
    assert.ok(CONTROL_PLANE_SECRET_ENV_KEYS.includes("RUNLOOP_API_KEY"));
    assert.throws(() =>
      assertNoControlPlaneSecrets({ RUNLOOP_API_KEY: "nope" }),
    );
  });
});
