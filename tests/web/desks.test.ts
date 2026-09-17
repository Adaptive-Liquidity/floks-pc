import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { mapComputerState } from "../../web/lib/desks/map-state.ts";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.js";
import { createSeat, resetSeatStoreForTests, getSeatStore } from "../../web/lib/billing/seats.ts";
import {
  approvePairCode,
  desksForSeats,
  issuePairKey,
  resetDeskRuntimeForTests,
  revokePairKey,
  webProviderName,
} from "../../web/lib/desks/runtime.ts";

describe("desk state mapping", () => {
  it("maps domain computer states onto the public desk language", () => {
    assert.equal(
      mapComputerState({
        computerState: null,
        pairStatus: "unpaired",
        hoursUsed: 0,
        hoursIncluded: 25,
        seatStatus: "active",
      }),
      "unused",
    );
    assert.equal(
      mapComputerState({
        computerState: "ready",
        pairStatus: "pairing",
        hoursUsed: 1,
        hoursIncluded: 25,
        seatStatus: "active",
      }),
      "pairing",
    );
    assert.equal(
      mapComputerState({
        computerState: "provisioning",
        pairStatus: "unpaired",
        hoursUsed: 0,
        hoursIncluded: 8,
        seatStatus: "active",
      }),
      "provisioning",
    );
    assert.equal(
      mapComputerState({
        computerState: "running",
        pairStatus: "paired",
        hoursUsed: 2,
        hoursIncluded: 8,
        seatStatus: "active",
      }),
      "running",
    );
    assert.equal(
      mapComputerState({
        computerState: "paused",
        pairStatus: "paired",
        hoursUsed: 2,
        hoursIncluded: 8,
        seatStatus: "active",
      }),
      "sleeping",
    );
    assert.equal(
      mapComputerState({
        computerState: "running",
        pairStatus: "paired",
        hoursUsed: 8,
        hoursIncluded: 8,
        seatStatus: "active",
      }),
      "hours_empty",
    );
    assert.equal(
      mapComputerState({
        computerState: "running",
        pairStatus: "paired",
        hoursUsed: 1,
        hoursIncluded: 8,
        seatStatus: "canceled",
      }),
      "shut_down",
    );
    assert.equal(
      mapComputerState({
        computerState: "error",
        pairStatus: "unpaired",
        hoursUsed: 0,
        hoursIncluded: 8,
        seatStatus: "active",
      }),
      "failed",
    );
  });
});

describe("pair keys on FakeProvider", () => {
  beforeEach(() => {
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
  });

  it("reveals a pair code once and revoke burns it", async () => {
    const service = new ComputerService(new FakeProvider());
    const computer = await service.requestComputer({ birdId: "seat:test", flockId: "flock-test" });
    const issued = await service.issuePairCode(computer.id);
    assert.match(issued.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    assert.equal(service.pairStatus(computer.id), "pairing");
    const burned = await service.revokeUnusedPairCodes(computer.id);
    assert.equal(burned, 1);
    assert.equal(service.pairStatus(computer.id), "unpaired");
  });

  it("lists an unused desk from a real seat without inventing localStorage state", async () => {
    const store = getSeatStore();
    const seat = await store.upsert(
      createSeat({
        email: "desk@example.com",
        plan: "spark",
        stripeCustomerId: "cus_desk",
      }),
    );
    const before = await desksForSeats([seat]);
    assert.equal(before[0]?.state, "unused");
    const issued = await issuePairKey(seat);
    assert.ok(issued.code.includes("-"));
    const after = await desksForSeats([await store.getById(seat.id) ?? seat]);
    assert.equal(after[0]?.state, "pairing");
    await revokePairKey(seat);
    const revoked = await desksForSeats([await store.getById(seat.id) ?? seat]);
    assert.equal(revoked[0]?.state, "unused");
  });

  it("approve fails closed when the presented code does not match", async () => {
    const store = getSeatStore();
    const seat = await store.upsert(
      createSeat({
        email: "pair@example.com",
        plan: "desk",
        stripeCustomerId: "cus_pair",
      }),
    );
    await issuePairKey(seat);
    assert.equal(await approvePairCode(seat, "XXXX-XXXX-XX"), "mismatch");
    assert.equal(webProviderName(), "fake");
  });
});
