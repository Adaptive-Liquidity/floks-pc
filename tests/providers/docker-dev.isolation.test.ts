/**
 * Gate C2 live isolation + persistence.
 * Skips unless FLOK_LIVE_DOCKER_TEST=1 AND `docker info` succeeds.
 * Never part of required CI / npm run verify.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DockerDevProvider } from "../../src/lib/computers/providers/index.js";

const LIVE = process.env.FLOK_LIVE_DOCKER_TEST === "1";
const dockerInfo = spawnSync("docker", ["info"], { encoding: "utf8" });
const dockerOk = LIVE && dockerInfo.status === 0;

describe("DockerDev C2 isolation + persistence", { skip: !dockerOk }, () => {
  const provider = new DockerDevProvider();
  const refs: string[] = [];

  after(async () => {
    for (const ref of refs) {
      await provider.destroy(ref).catch(() => undefined);
    }
  });

  it("A cannot read B's /workspace file and vice versa; persistence across stop/wake", async () => {
    const a = await provider.provision({ birdId: "bird-a", flockId: "flock-1" });
    const b = await provider.provision({ birdId: "bird-b", flockId: "flock-1" });
    refs.push(a.providerRef, b.providerRef);
    assert.notEqual(a.providerRef, b.providerRef);

    const writeA = await provider.filesystem(a.providerRef, {
      operation: "write",
      path: "/workspace/A.txt",
      content: "secret-from-A",
    });
    assert.equal(writeA.ok, true);

    const writeB = await provider.filesystem(b.providerRef, {
      operation: "write",
      path: "/workspace/B.txt",
      content: "secret-from-B",
    });
    assert.equal(writeB.ok, true);

    const readAFromB = await provider.filesystem(b.providerRef, {
      operation: "read",
      path: "/workspace/A.txt",
    });
    assert.equal(readAFromB.ok, false);

    const readBFromA = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "/workspace/B.txt",
    });
    assert.equal(readBFromA.ok, false);

    const readOwn = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "/workspace/A.txt",
    });
    assert.equal(readOwn.ok, true);
    assert.equal(readOwn.data, "secret-from-A");

    const execA = await provider.exec(a.providerRef, {
      argv: ["cat", "/workspace/A.txt"],
    });
    assert.equal(execA.exitCode, 0);
    assert.ok(execA.stdout.includes("secret-from-A"));

    const execB = await provider.exec(b.providerRef, {
      argv: ["cat", "/workspace/A.txt"],
    });
    assert.notEqual(execB.exitCode, 0);

    await provider.stop(a.providerRef);
    const stopped = await provider.status(a.providerRef);
    assert.equal(stopped.state, "stopped");
    await provider.wake(a.providerRef);

    const afterWake = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "/workspace/A.txt",
    });
    assert.equal(afterWake.ok, true);
    assert.equal(afterWake.data, "secret-from-A");

    await provider.destroy(a.providerRef);
    refs.splice(refs.indexOf(a.providerRef), 1);

    const bSurvives = await provider.filesystem(b.providerRef, {
      operation: "read",
      path: "/workspace/B.txt",
    });
    assert.equal(bSurvives.ok, true);
    assert.equal(bSurvives.data, "secret-from-B");
  });
});
