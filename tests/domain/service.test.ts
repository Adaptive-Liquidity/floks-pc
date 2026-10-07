/**
 * ComputerService domain tests — uses FakeProvider only.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerService,
  FakeProvider,
  DuplicateComputer,
  IllegalStateTransition,
  ComputerNotFound,
  ProviderUnavailable,
  MemoryControlPlaneStore,
} from "../../src/lib/computers/index.js";

describe("ComputerService", () => {
  let provider: FakeProvider;
  let service: ComputerService;

  beforeEach(() => {
    provider = new FakeProvider();
    service = new ComputerService(provider);
  });

  it("provisions a computer for a birdId", async () => {
    const c = await service.requestComputer({
      birdId: "bird-1",
      flockId: "flock-1",
    });
    assert.equal(c.birdId, "bird-1");
    assert.equal(c.state, "ready");
    assert.equal(c.provider, "fake");
    assert.ok(c.providerRef);
    assert.ok(c.id);
  });

  it("rejects duplicate birdId", async () => {
    await service.requestComputer({ birdId: "bird-1", flockId: "f" });
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-1", flockId: "f" }),
      (err: unknown) => err instanceof DuplicateComputer,
    );
  });

  it("allows different birdIds", async () => {
    const a = await service.requestComputer({ birdId: "a", flockId: "f" });
    const b = await service.requestComputer({ birdId: "b", flockId: "f" });
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.providerRef, b.providerRef);
  });

  it("get and getByBird work", async () => {
    const c = await service.requestComputer({ birdId: "x", flockId: "f" });
    const byId = await service.get(c.id);
    assert.equal(byId.id, c.id);
    const byBird = await service.getByBird("x");
    assert.ok(byBird);
    assert.equal(byBird.id, c.id);
    const missing = await service.getByBird("nope");
    assert.equal(missing, null);
  });

  it("get unknown id throws ComputerNotFound", async () => {
    await assert.rejects(
      () => service.get("does-not-exist"),
      (err: unknown) => err instanceof ComputerNotFound,
    );
  });

  it("legal transition ready → running succeeds", async () => {
    const c = await service.requestComputer({ birdId: "t", flockId: "f" });
    const updated = await service.transition(c.id, "running");
    assert.equal(updated.state, "running");
  });

  it("illegal transition ready → requested throws", async () => {
    const c = await service.requestComputer({ birdId: "t", flockId: "f" });
    await assert.rejects(
      () => service.transition(c.id, "requested"),
      (err: unknown) => err instanceof IllegalStateTransition,
    );
  });

  it("pause then wake works", async () => {
    const c = await service.requestComputer({ birdId: "t", flockId: "f" });
    await service.transition(c.id, "running");
    const paused = await service.transition(c.id, "paused");
    assert.equal(paused.state, "paused");
    const woken = await service.transition(c.id, "running");
    assert.equal(woken.state, "running");
  });

  it("records a thrown provision as error instead of provisioning", async () => {
    provider.injectFailure("provision", "unavailable");
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-fail", flockId: "flock-fail" }),
      (err: unknown) => err instanceof ProviderUnavailable,
    );
    const failed = await service.getByBird("bird-fail");
    assert.ok(failed);
    assert.equal(failed.state, "error");
    assert.equal(failed.providerRef, null);
  });

  it("moves a provisioning computer with no provider ref to error on status", async () => {
    const store = new MemoryControlPlaneStore();
    const owned = new ComputerService(new FakeProvider(), { store });
    const computer = await owned.requestComputer({ birdId: "bird-stuck", flockId: "flock-stuck" });
    const issued = await owned.issuePairCode(computer.id);
    const paired = await owned.pair(issued.code, { birdId: "bird-stuck", flockId: "flock-stuck" });
    const snap = await store.load();
    assert.ok(snap);
    const row = snap.computers.find((item) => item.id === computer.id);
    assert.ok(row);
    row.state = "provisioning";
    row.providerRef = null;
    await store.save(snap);
    await owned.reloadIfRevisionChanged();
    const status = await owned.status({ kind: "capability", token: paired.token }, computer.id);
    assert.equal(status.state, "error");
    const after = await owned.get(computer.id);
    assert.equal(after.state, "error");
    assert.equal(after.providerRef, null);

    const kept = await owned.requestComputer({ birdId: "bird-kept", flockId: "flock-stuck" });
    const keptSnap = await store.load();
    assert.ok(keptSnap);
    const keptRow = keptSnap.computers.find((item) => item.id === kept.id);
    assert.ok(keptRow);
    keptRow.state = "provisioning";
    await store.save(keptSnap);
    await owned.reloadIfRevisionChanged();
    const stillStarting = await owned.failProvisioningWithoutRef(kept.id);
    assert.equal(stillStarting.state, "provisioning");
    assert.ok(stillStarting.providerRef);
  });

  it("delete removes from byBird index", async () => {
    const c = await service.requestComputer({ birdId: "t", flockId: "f" });
    // ready → deleting → deleted
    await service.transition(c.id, "deleting");
    await service.transition(c.id, "deleted");
    const after = await service.getByBird("t");
    assert.equal(after, null);
  });
});
