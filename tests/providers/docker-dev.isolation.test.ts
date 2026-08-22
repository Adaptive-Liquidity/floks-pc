/**
 * Gate C2 live isolation + persistence.
 * Skip ONLY when FLOK_LIVE_DOCKER_TEST is absent.
 * When the flag is set, Docker unavailability FAILs — never silent skip.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DockerDevProvider } from "../../src/lib/computers/providers/index.js";

const LIVE = process.env.FLOK_LIVE_DOCKER_TEST === "1";

function dockerInfo(): ReturnType<typeof spawnSync> {
  return spawnSync("docker", ["info"], { encoding: "utf8", timeout: 10_000 });
}

describe("DockerDev C2 isolation + persistence", { skip: !LIVE }, () => {
  const provider = new DockerDevProvider();
  const refs: string[] = [];

  before(() => {
    const probe = dockerInfo();
    if (probe.status !== 0) {
      const detail = (probe.stderr || probe.error?.message || "docker info failed").toString();
      throw new Error(
        `FLOK_LIVE_DOCKER_TEST=1 but Docker is unavailable (must FAIL, not skip): ${detail}`,
      );
    }
  });

  after(async () => {
    for (const ref of [...refs]) {
      await provider.destroy(ref).catch(() => undefined);
    }
    refs.length = 0;
  });

  it("A cannot read B's /workspace file and vice versa", async () => {
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
  });

  it("workspace persists across stop/wake", async () => {
    const a = await provider.provision({ birdId: "bird-persist", flockId: "flock-1" });
    refs.push(a.providerRef);

    const writeA = await provider.filesystem(a.providerRef, {
      operation: "write",
      path: "/workspace/A.txt",
      content: "secret-from-A",
    });
    assert.equal(writeA.ok, true);

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
  });

  it("rejects symlink jailbreaks that resolve outside /workspace", async () => {
    const a = await provider.provision({ birdId: "bird-jail", flockId: "flock-1" });
    refs.push(a.providerRef);

    const link = await provider.exec(a.providerRef, {
      argv: ["ln", "-s", "/etc", "/workspace/link"],
    });
    assert.equal(link.exitCode, 0, link.stderr);

    const escapedRead = await provider.filesystem(a.providerRef, {
      operation: "read",
      path: "/workspace/link/passwd",
    });
    assert.equal(escapedRead.ok, false);
    assert.equal(escapedRead.errorCode, "PATH_ESCAPE");
    assert.notEqual(typeof escapedRead.data, "string");

    const escapedStat = await provider.filesystem(a.providerRef, {
      operation: "stat",
      path: "/workspace/link/passwd",
    });
    assert.equal(escapedStat.ok, false);
    assert.equal(escapedStat.errorCode, "PATH_ESCAPE");

    const escapedCwd = await provider.exec(a.providerRef, {
      argv: ["pwd"],
      cwd: "/workspace/link",
    });
    assert.equal(escapedCwd.exitCode, 126);
    assert.match(escapedCwd.stderr, /PATH_ESCAPE/);
  });

  it("destroying A removes its volume and does not leak B", async () => {
    const a = await provider.provision({ birdId: "bird-destroy-a", flockId: "flock-1" });
    const b = await provider.provision({ birdId: "bird-destroy-b", flockId: "flock-1" });
    refs.push(a.providerRef, b.providerRef);

    const writeB = await provider.filesystem(b.providerRef, {
      operation: "write",
      path: "/workspace/B.txt",
      content: "secret-from-B",
    });
    assert.equal(writeB.ok, true);

    await provider.destroy(a.providerRef);
    const removeAt = refs.indexOf(a.providerRef);
    if (removeAt !== -1) refs.splice(removeAt, 1);

    const volumes = spawnSync(
      "docker",
      ["volume", "ls", "-q", "--filter", `name=flok-ws-${a.providerRef}`],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(volumes.status, 0);
    assert.equal(volumes.stdout.trim(), "");

    const bSurvives = await provider.filesystem(b.providerRef, {
      operation: "read",
      path: "/workspace/B.txt",
    });
    assert.equal(bSurvives.ok, true);
    assert.equal(bSurvives.data, "secret-from-B");
  });
});
