import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { mapComputerState } from "../../web/lib/desks/map-state.ts";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.js";
import { createSeat, resetSeatStoreForTests, getSeatStore } from "../../web/lib/billing/seats.ts";
import {
  approvePairCode,
  birdIdForSeat,
  desksForSeats,
  ensureComputer,
  flockIdForEmail,
  issuePairKey,
  resetDeskRuntimeForTests,
  revokePairKey,
  setComputerServiceForTests,
  setPairRevealStoreForTests,
  webProviderName,
} from "../../web/lib/desks/runtime.ts";
import { MemoryPairRevealStore } from "../../web/lib/desks/reveal-store.ts";

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
    setPairRevealStoreForTests(null);
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
        plan: "personal",
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
        plan: "pro",
        stripeCustomerId: "cus_pair",
      }),
    );
    await issuePairKey(seat);
    assert.equal(await approvePairCode(seat, "XXXX-XXXX-XX"), "mismatch");
    assert.equal(webProviderName(), "fake");
  });

  it("shows the same pair code on a second instance", async () => {
    const shared = new Map<string, { code: string; pairCodeId: string }>();
    const first = new MemoryPairRevealStore(shared);
    const second = new MemoryPairRevealStore(shared);
    setPairRevealStoreForTests(first);
    const store = getSeatStore();
    const seat = await store.upsert(
      createSeat({
        email: "two@example.com",
        plan: "personal",
        stripeCustomerId: "cus_two",
      }),
    );
    const issued = await issuePairKey(seat);
    resetDeskRuntimeForTests();
    setPairRevealStoreForTests(second);
    const desks = await desksForSeats([seat]);
    assert.equal(desks[0]?.userCode, issued.code);
  });

  it("lets a warm instance pair a code issued later and show it on setup", async () => {
    const store = new MemoryControlPlaneStore();
    const provider = new FakeProvider();
    const issuer = new ComputerService(provider, { store });
    const warm = new ComputerService(provider, { store });
    setComputerServiceForTests(issuer);
    const seat = await getSeatStore().upsert(
      createSeat({
        email: "warm@example.com",
        plan: "personal",
        stripeCustomerId: "cus_warm",
      }),
    );
    await ensureComputer(seat);
    await warm.hydrate();
    const issued = await issuePairKey(seat);
    setComputerServiceForTests(warm);
    const desks = await desksForSeats([seat]);
    assert.equal(desks[0]?.userCode, issued.code);
    const paired = await warm.pair(issued.code, {
      birdId: birdIdForSeat(seat),
      flockId: flockIdForEmail(seat.email),
    });
    assert.equal(paired.flockId, flockIdForEmail(seat.email));
  });

  it("keeps each seat's reveal across 50 issue and revoke cycles", async () => {
    const shared = new Map<string, { code: string; pairCodeId: string }>();
    const writer = new MemoryPairRevealStore(shared);
    const reader = new MemoryPairRevealStore(shared);
    setPairRevealStoreForTests(writer);
    const store = getSeatStore();
    for (let i = 0; i < 50; i++) {
      const seat = await store.upsert(
        createSeat({
          email: `cycle-${i}@example.com`,
          plan: "personal",
          stripeCustomerId: `cus_cycle_${i}`,
        }),
      );
      const issued = await issuePairKey(seat);
      setPairRevealStoreForTests(reader);
      const seen = await desksForSeats([seat]);
      assert.equal(seen[0]?.userCode, issued.code);
      setPairRevealStoreForTests(writer);
      await revokePairKey(seat);
      setPairRevealStoreForTests(reader);
      const cleared = await desksForSeats([seat]);
      assert.equal(cleared[0]?.userCode, null);
      setPairRevealStoreForTests(writer);
    }
  });
});
