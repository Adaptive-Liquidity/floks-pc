/**
 * DaytonaProvider — non-live tests. Zero network / zero Daytona API.
 * Injected MemoryDaytonaControlPlane only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerService,
  DaytonaProvider,
  DaytonaLinuxVmRequired,
  MemoryDaytonaControlPlane,
  FLAGS,
  assertNexusDisabled,
  ProviderUnavailable,
} from "../../src/lib/computers/index.js";
import {
  assertNoControlPlaneSecrets,
  CONTROL_PLANE_SECRET_ENV_KEYS,
  DAYTONA_WORKSPACE_ROOT,
} from "../../src/lib/computers/providers/index.js";

function provider(): DaytonaProvider {
  return new DaytonaProvider({
    client: new MemoryDaytonaControlPlane(),
    snapshot: "memory-linux-vm",
  });
}

describe("DaytonaProvider (no network)", () => {
  it("reports provider name daytona", () => {
    assert.equal(provider().name, "daytona");
  });

  it("advertises Linux VM capabilities", () => {
    const caps = provider().capabilities();
    assert.equal(caps.linuxVm, true);
    assert.equal(caps.windowsVm, false);
    assert.equal(caps.pauseMemory, true);
    assert.equal(caps.snapshots, true);
    assert.equal(caps.computerUse, true);
    assert.equal(caps.vnc, true);
    assert.equal(caps.accessibility, true);
  });

  it("rejects construction without DAYTONA_API_KEY when no client is injected", () => {
    const prevKey = process.env.DAYTONA_API_KEY;
    const prevSnap = process.env.FLOK_DAYTONA_SNAPSHOT;
    delete process.env.DAYTONA_API_KEY;
    delete process.env.FLOK_DAYTONA_SNAPSHOT;
    try {
      assert.throws(
        () => new DaytonaProvider(),
        (err: unknown) =>
          err instanceof ProviderUnavailable && err.code === "PROVIDER_UNAVAILABLE",
      );
    } finally {
      if (prevKey === undefined) delete process.env.DAYTONA_API_KEY;
      else process.env.DAYTONA_API_KEY = prevKey;
      if (prevSnap === undefined) delete process.env.FLOK_DAYTONA_SNAPSHOT;
      else process.env.FLOK_DAYTONA_SNAPSHOT = prevSnap;
    }
  });

  it("rejects missing Linux VM snapshot when key is present but client is not", () => {
    const prevKey = process.env.DAYTONA_API_KEY;
    const prevSnap = process.env.FLOK_DAYTONA_SNAPSHOT;
    process.env.DAYTONA_API_KEY = "test-key-not-for-guest";
    delete process.env.FLOK_DAYTONA_SNAPSHOT;
    try {
      assert.throws(
        () => new DaytonaProvider(),
        (err: unknown) =>
          err instanceof DaytonaLinuxVmRequired &&
          err.code === "DAYTONA_LINUX_VM_REQUIRED",
      );
    } finally {
      if (prevKey === undefined) delete process.env.DAYTONA_API_KEY;
      else process.env.DAYTONA_API_KEY = prevKey;
      if (prevSnap === undefined) delete process.env.FLOK_DAYTONA_SNAPSHOT;
      else process.env.FLOK_DAYTONA_SNAPSHOT = prevSnap;
    }
  });

  it("rejects windows osType", async () => {
    await assert.rejects(
      () => provider().provision({ birdId: "w", flockId: "f", osType: "windows" }),
      (err: unknown) => err instanceof ProviderUnavailable,
    );
  });

  it("ComputerService records provider daytona", async () => {
    const service = new ComputerService(provider());
    const c = await service.requestComputer({ birdId: "bird-1", flockId: "flock-1" });
    assert.equal(c.provider, "daytona");
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
      env: { DAYTONA_API_KEY: "must-not-enter-guest" },
    });
    assert.equal(secret.exitCode, 126);
    assert.match(secret.stderr, /DAYTONA_API_KEY/);
  });

  it("jails filesystem paths to /home/flok", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "jail", flockId: "f" });
    const escaped = await p.filesystem(a.providerRef, {
      operation: "read",
      path: "/etc/passwd",
    });
    assert.equal(escaped.ok, false);
    assert.equal(escaped.errorCode, "PATH_ESCAPE");

    const cwd = await p.exec(a.providerRef, {
      argv: ["pwd"],
      cwd: "/etc",
    });
    assert.equal(cwd.exitCode, 126);
    assert.match(cwd.stderr, /PATH_ESCAPE/);
  });

  it("writes and reads under /home/flok", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "fs", flockId: "f" });
    const w = await p.filesystem(a.providerRef, {
      operation: "write",
      path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
      content: "hello-daytona",
    });
    assert.equal(w.ok, true);
    const r = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/A.txt`,
    });
    assert.equal(r.ok, true);
    assert.equal(r.data, "hello-daytona");
  });

  it("observe / act / takeover work on the memory plane", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "ui", flockId: "f" });
    const obs = await p.observe(a.providerRef, { includeScreenshot: true });
    assert.ok(obs.screenWidth > 0);
    assert.ok(obs.screenshotBase64);

    const acted = await p.act(a.providerRef, {
      actions: [{ type: "type", text: "hi" }],
    });
    assert.equal(acted.ok, true);

    const grant = await p.takeover(a.providerRef);
    assert.equal(grant.singleUse, true);
    assert.ok(grant.url.includes(a.providerRef));
    assert.ok(grant.expiresAt.getTime() > Date.now());
  });

  it("checkpoint + restore yields a new providerRef with persisted files", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "cp", flockId: "f" });
    await p.filesystem(a.providerRef, {
      operation: "write",
      path: `${DAYTONA_WORKSPACE_ROOT}/keep.txt`,
      content: "persist-me",
    });
    const snap = await p.checkpoint(a.providerRef);
    assert.ok(snap.providerSnapshotRef);
    const restored = await p.restore({
      computerId: a.providerRef,
      checkpointId: "ck-1",
      providerSnapshotRef: snap.providerSnapshotRef,
    });
    assert.notEqual(restored.providerRef, a.providerRef);
    const read = await p.filesystem(restored.providerRef, {
      operation: "read",
      path: `${DAYTONA_WORKSPACE_ROOT}/keep.txt`,
    });
    assert.equal(read.ok, true);
    assert.equal(read.data, "persist-me");
  });

  it("hard-locks Nexus / graph flags", () => {
    assert.equal(FLAGS.FLOK_NEXUS_IQ_ENABLED, false);
    assert.equal(FLAGS.FLOK_GRAPH_MEMORY_ENABLED, false);
    assertNexusDisabled();
  });
});

describe("control-plane secret guard", () => {
  it("lists DAYTONA_API_KEY among forbidden guest env keys", () => {
    assert.ok(CONTROL_PLANE_SECRET_ENV_KEYS.includes("DAYTONA_API_KEY"));
  });

  it("throws if a caller tries to inject the API key into guest env", () => {
    assert.throws(() =>
      assertNoControlPlaneSecrets({ DAYTONA_API_KEY: "leak" }),
    );
  });
});
