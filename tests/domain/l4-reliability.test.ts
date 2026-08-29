/**
 * L4 reliability / recovery. Unpaid. FakeProvider. No live Runloop.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BetaRegistry,
  BETA_COST_WARNING,
  CheckpointRequired,
  ComputerService,
  DockerDevProvider,
  FakeProvider,
  MemoryBetaStore,
  MemoryControlPlaneStore,
  ObserveRetryable,
  RestoreUnsupported,
  capabilityAuth,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("L4 reliability / recovery", () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = new FakeProvider();
  });

  it("PHASES marks L3/L4 closed; L5 is owner-requested; do not auto-start L6+", () => {
    const phases = readFileSync(join(root, "PHASES.md"), "utf8");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.match(phases, /Usable private-beta product is L0–L3/);
    assert.match(phases, /L4 is optional insurance/);
    assert.match(phases, /### PHASE L3[\s\S]*?\*\*Status:\*\* CLOSED \/ PASSED/);
    assert.match(phases, /### PHASE L4[\s\S]*?\*\*Status:\*\* CLOSED \/ PASSED/);
    assert.match(phases, /### PHASE L5[\s\S]*?\*\*Status:\*\* OPEN/);
    assert.doesNotMatch(phases, /Current open phase: L4/);
    assert.match(agents, /L0–L3 is enough for a usable private beta/);
    assert.match(agents, /L4 CLOSED \(PR #24/);
    assert.match(agents, /Current owner-requested work: L5/);
    assert.match(agents, /Do not automatically start L6 \/ L7 \/ L8 \/ G0/);
  });

  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("stores checkpoint metadata without secrets and restores the latest snapshot", async () => {
    const store = new MemoryControlPlaneStore();
    const service = new ComputerService(provider, { store });
    const computer = await service.requestComputer({ birdId: "bird-keep", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-keep", flockId: "flock-a" });
    const wrote = await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "write",
      path: "/home/flok/recovery-proof/hello.txt",
      content: "hello-l4",
    });
    assert.equal(wrote.ok, true);
    const checkpointed = await service.checkpointThisComputer(computer.id);
    assert.equal(checkpointed.latestCheckpoint?.status, "ready");
    assert.ok(checkpointed.latestCheckpoint?.id);
    assert.ok(checkpointed.latestCheckpoint?.providerSnapshotRef);
    const blob = JSON.stringify(checkpointed.latestCheckpoint);
    assert.doesNotMatch(blob, /"token"/);
    assert.doesNotMatch(blob, /screenshot/i);
    assert.doesNotMatch(blob, /RUNLOOP_API_KEY/);
    const reloaded = new ComputerService(provider, { store });
    await reloaded.hydrate();
    assert.equal((await reloaded.get(computer.id)).latestCheckpoint?.status, "ready");
    const recovered = await reloaded.recoverThisComputer(computer.id);
    assert.equal(recovered.state, "ready");
    assert.equal(recovered.latestCheckpoint?.status, "restored");
    assert.notEqual(recovered.providerRef, computer.providerRef);
    const read = await reloaded.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "read",
      path: "/home/flok/recovery-proof/hello.txt",
    });
    assert.equal(read.ok, true);
    assert.equal(read.data, "hello-l4");
  });

  it("restore without a checkpoint fails closed", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-none", flockId: "flock-a" });
    await assert.rejects(
      () => service.recoverThisComputer(computer.id),
      (err: unknown) => err instanceof CheckpointRequired,
    );
    const live = await service.get(computer.id);
    assert.equal(live.state, "ready");
    assert.equal(live.providerRef, computer.providerRef);
  });

  it("recovery path ends ready after checkpoint", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-path", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-path", flockId: "flock-a" });
    await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "write",
      path: "/home/flok/recovery-proof/hello.txt",
      content: "path",
    });
    await service.checkpointThisComputer(computer.id);
    const recovered = await service.recoverThisComputer(computer.id);
    assert.equal(recovered.state, "ready");
    assert.ok(service.listOperatorEvents().some((e) => e.operation === "recover" && e.success));
  });

  it("restore-unsupported recovery does not destroy the original VM and stays retryable", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-keep-orig", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-keep-orig", flockId: "flock-a" });
    await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "write",
      path: "/home/flok/recovery-proof/hello.txt",
      content: "keep",
    });
    await service.checkpointThisComputer(computer.id);
    provider.injectFailure("restore", "restore_unsupported");
    await assert.rejects(
      () => service.recoverThisComputer(computer.id),
      (err: unknown) => err instanceof RestoreUnsupported,
    );
    const live = await service.get(computer.id);
    assert.equal(live.providerRef, computer.providerRef);
    assert.equal(live.latestCheckpoint?.status, "ready");
    const read = await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "read",
      path: "/home/flok/recovery-proof/hello.txt",
    });
    assert.equal(read.data, "keep");
  });

  it("failed health probe after restore marks recovery_failed and remains retryable", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-probe", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-probe", flockId: "flock-a" });
    await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "write",
      path: "/home/flok/recovery-proof/hello.txt",
      content: "probe",
    });
    await service.checkpointThisComputer(computer.id);
    provider.injectFailure("healthProbe", "unavailable");
    await assert.rejects(() => service.recoverThisComputer(computer.id));
    const failed = await service.get(computer.id);
    assert.equal(failed.state, "recovery_failed");
    assert.equal(failed.latestCheckpoint?.status, "ready");
    assert.equal(failed.providerRef, computer.providerRef);
  });

  it("serializes concurrent recovery; workspace survives even if the second recover restores again", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-race", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-race", flockId: "flock-a" });
    await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "write",
      path: "/home/flok/recovery-proof/hello.txt",
      content: "race",
    });
    await service.checkpointThisComputer(computer.id);
    const [a, b] = await Promise.all([
      service.recoverThisComputer(computer.id),
      service.recoverThisComputer(computer.id),
    ]);
    assert.equal(a.state, "ready");
    assert.equal(b.state, "ready");
    assert.ok(a.providerRef);
    assert.ok(b.providerRef);
    assert.notEqual(a.providerRef, computer.providerRef);
    assert.notEqual(b.providerRef, computer.providerRef);
    const read = await service.filesystem(capabilityAuth(cap.token), computer.id, {
      operation: "read",
      path: "/home/flok/recovery-proof/hello.txt",
    });
    assert.equal(read.data, "race");
  });

  it("stale cleanup uses captured providerRef and records cleanup_needed on destroy failure", async () => {
    let now = 1_000_000;
    const registry = new BetaRegistry(new MemoryBetaStore());
    await registry.approveOwner("owner-a");
    const service = new ComputerService(provider, {
      store: new MemoryControlPlaneStore(),
      ownerId: "owner-a",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 5_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: registry,
      now: () => now,
    });
    const computer = await service.requestComputer({ birdId: "bird-stale", flockId: "flock-a" });
    provider.injectFailure("destroy", "unavailable");
    now = 1_010_000;
    const destroyed = await service.sweepIdle(now);
    assert.equal(destroyed.length, 0);
    assert.equal((await service.get(computer.id)).state, "cleanup_needed");
    const events = service.listOperatorEvents().filter((e) => e.errorCode === "CLEANUP_FAILED");
    assert.ok(events.length >= 1);
    assert.equal(events[0]?.kind, "cleanup");
  });

  it("pause then wake re-probes before ready; observe while paused is retry-safe", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-obs", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-obs", flockId: "flock-a" });
    await service.pauseThisComputer(computer.id);
    await assert.rejects(
      () =>
        service.observe(capabilityAuth(cap.token), computer.id, {
          includeAccessibility: true,
        }),
      (err: unknown) => err instanceof ObserveRetryable,
    );
    await assert.rejects(
      () => service.operatorObserve(computer.id, { includeAccessibility: true }),
      (err: unknown) => err instanceof ObserveRetryable,
    );
    const woken = await service.wakeThisComputer(computer.id);
    assert.equal(woken.state, "ready");
    const observation = await service.observe(capabilityAuth(cap.token), computer.id, {
      includeAccessibility: true,
    });
    assert.ok(observation.screenWidth > 0);
  });

  it("wake health-probe failure marks recovery_failed", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-wake", flockId: "flock-a" });
    await service.pauseThisComputer(computer.id);
    provider.injectFailure("healthProbe", "unavailable");
    await assert.rejects(() => service.wakeThisComputer(computer.id));
    assert.equal((await service.get(computer.id)).state, "recovery_failed");
  });

  it("DockerDev restore is unsupported with a documented error", async () => {
    const docker = new DockerDevProvider();
    assert.equal(docker.capabilities().snapshots, false);
    await assert.rejects(
      () =>
        docker.restore({
          computerId: "c1",
          checkpointId: "ck1",
          providerSnapshotRef: "vol",
        }),
      (err: unknown) => err instanceof RestoreUnsupported,
    );
  });

  it("refuses checkpoint when the provider cannot snapshot", async () => {
    class NoSnapshotFake extends FakeProvider {
      capabilities() {
        return { ...super.capabilities(), snapshots: false };
      }
    }
    const noSnap = new NoSnapshotFake();
    const service = new ComputerService(noSnap, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({
      birdId: "bird-nosnap",
      flockId: "flock-a",
    });
    await assert.rejects(
      () => service.checkpointThisComputer(computer.id),
      (err: unknown) => err instanceof RestoreUnsupported,
    );
    const after = await service.get(computer.id);
    assert.equal(after.state, "ready");
    assert.equal(after.latestCheckpoint, null);
  });

  it("debug packet omits providerSnapshotRef and tokens", async () => {
    const service = new ComputerService(provider, { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-dbg", flockId: "flock-a" });
    await service.checkpointThisComputer(computer.id);
    const packet = JSON.stringify(service.debugPacket());
    assert.doesNotMatch(packet, /providerSnapshotRef/);
    assert.doesNotMatch(packet, /"token"/);
    assert.doesNotMatch(packet, /tokenDigest/);
    assert.doesNotMatch(packet, /screenshotBase64/);
    assert.match(packet, /checkpointStatus/);
  });
});
