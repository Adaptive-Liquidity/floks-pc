import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { mapComputerState } from "../../web/lib/desks/map-state.ts";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.js";
import { createSeat, resetSeatStoreForTests, getSeatStore } from "../../web/lib/billing/seats.ts";
import { provisionSeatComputers, shutdownSeatComputers } from "../../web/lib/billing/lifecycle.ts";
import { claimStripeEvent, releaseStripeEvent, resetStripeEventsForTests } from "../../web/lib/billing/stripe-events.ts";
import {
  approvePairCode,
  consumeRevealedCode,
  desksForSeats,
  flockIdForEmail,
  getComputerService,
  issuePairKey,
  resetDeskRuntimeForTests,
  revokePairKey,
  setPairRevealStoreForTests,
  webProviderName,
} from "../../web/lib/desks/runtime.ts";
import { MemoryOauthStore, getOauthStore, setOauthStoreForTests } from "../../web/lib/oauth.ts";
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

  it("provisions one computer when two setup calls overlap", async () => {
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
    const seat = await getSeatStore().upsert(
      createSeat({
        email: "lock@example.com",
        plan: "personal",
        stripeCustomerId: "cus_lock",
        status: "active",
      }),
    );
    const [first, second] = await Promise.all([provisionSeatComputers(seat), provisionSeatComputers(seat)]);
    const ids = new Set([...first, ...second].map((computer) => computer.id));
    assert.equal(ids.size, 1);
    assert.equal(first[0]?.id, second[0]?.id);
  });

  it("revokes the owner token, pair code, and reveal before destroy", async () => {
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
    resetStripeEventsForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const seat = await getSeatStore().upsert(
      createSeat({
        email: "cancel@example.com",
        plan: "personal",
        stripeCustomerId: "cus_cancel",
        status: "active",
      }),
    );
    const created = await provisionSeatComputers(seat);
    assert.equal(created.length, 1);
    const computerId = created[0]?.id ?? "";
    const issued = await issuePairKey({ ...seat, computerId, computerIds: [computerId] });
    await getOauthStore().saveAccess({
      tokenHash: "hash-cancel",
      refreshHash: "refresh-cancel",
      subject: "user_01JCANCEL",
      flock: flockIdForEmail(seat.email),
      clientId: "stax_test",
      expiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      revoked: false,
    });
    await shutdownSeatComputers({ ...seat, status: "canceled", computerId, computerIds: [computerId] });
    assert.equal((await getOauthStore().getAccess("hash-cancel"))?.revoked, true);
    assert.equal(await consumeRevealedCode(seat.id), null);
    const service = await getComputerService();
    const open = service.listPairCodes(computerId).filter((code) => code.usedAt === null);
    assert.equal(open.length, 0);
    assert.equal(issued.code.length > 0, true);
    assert.equal(await claimStripeEvent("evt_retry", "customer.subscription.deleted"), "new");
    assert.equal(await claimStripeEvent("evt_retry", "customer.subscription.deleted"), "duplicate");
    await releaseStripeEvent("evt_retry");
    assert.equal(await claimStripeEvent("evt_retry", "customer.subscription.deleted"), "new");
  });
});
