/**
 * FakeProvider contract + isolation tests.
 * Zero network / Docker / Daytona.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FakeProvider } from "../../src/lib/computers/index.js";
import { ProviderUnavailable } from "../../src/lib/computers/index.js";

describe("FakeProvider", () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = new FakeProvider();
  });

  it("implements capabilities", () => {
    const caps = provider.capabilities();
    assert.equal(caps.linuxVm, true);
    assert.equal(caps.computerUse, true);
    assert.equal(caps.vnc, true);
  });

  it("provisions two independent machines", async () => {
    const a = await provider.provision({
      birdId: "bird-a",
      flockId: "flock-1",
    });
    const b = await provider.provision({
      birdId: "bird-b",
      flockId: "flock-1",
    });
    assert.notEqual(a.providerRef, b.providerRef);
    assert.equal(a.status, "ready");
    assert.equal(b.status, "ready");
  });

  it("FS isolation: A cannot read B's files", async () => {
    const a = await provider.provision({ birdId: "a", flockId: "f" });
    const b = await provider.provision({ birdId: "b", flockId: "f" });

    await provider.filesystem(a.providerRef, {
      operation: "write",
      path: "workspace/A.txt",
      content: "secret-from-A",
    });
    await provider.filesystem(b.providerRef, {
      operation: "write",
      path: "workspace/B.txt",
      content: "secret-from-B",
    });

    const readAFromB = await provider.filesystem(b.providerRef, {
      operation: "read",
      path: "workspace/A.txt",
    });
    assert.equal(readAFromB.ok, false);

    const readBFromA = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "workspace/B.txt",
    });
    assert.equal(readBFromA.ok, false);

    const readOwn = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "workspace/A.txt",
    });
    assert.equal(readOwn.ok, true);
    assert.equal(readOwn.data, "secret-from-A");
  });

  it("rejects path escape", async () => {
    const a = await provider.provision({ birdId: "a", flockId: "f" });
    const result = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "../etc/passwd",
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "PATH_ESCAPE");
  });

  it("injectFailure causes provision to throw", async () => {
    provider.injectFailure("provision", "unavailable");
    await assert.rejects(
      () => provider.provision({ birdId: "x", flockId: "y" }),
      (err: unknown) => err instanceof ProviderUnavailable,
    );
  });

  it("exec returns deterministic stub", async () => {
    const a = await provider.provision({ birdId: "a", flockId: "f" });
    const result = await provider.exec(a.providerRef, {
      argv: ["echo", "hello"],
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("echo hello"));
  });

  it("lifecycle: pause → wake", async () => {
    const a = await provider.provision({ birdId: "a", flockId: "f" });
    await provider.pause(a.providerRef);
    const paused = await provider.status(a.providerRef);
    assert.equal(paused.state, "paused");
    await provider.wake(a.providerRef);
    const running = await provider.status(a.providerRef);
    assert.equal(running.state, "running");
  });

  it("destroy removes the machine", async () => {
    const a = await provider.provision({ birdId: "a", flockId: "f" });
    await provider.destroy(a.providerRef);
    await assert.rejects(
      () => provider.status(a.providerRef),
      (err: unknown) => err instanceof ProviderUnavailable,
    );
  });
});
