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

  it("delete removes from byBird index", async () => {
    const c = await service.requestComputer({ birdId: "t", flockId: "f" });
    // ready → deleting → deleted
    await service.transition(c.id, "deleting");
    await service.transition(c.id, "deleted");
    const after = await service.getByBird("t");
    assert.equal(after, null);
  });
});
