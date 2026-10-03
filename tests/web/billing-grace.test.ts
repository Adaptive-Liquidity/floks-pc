import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ComputerService, MemoryRunloopControlPlane, RunloopProvider } from "../../src/lib/computers/index.ts";
import type {
  RunloopControlPlane,
  RunloopCreateParams,
  RunloopDevboxSession,
} from "../../src/lib/computers/providers/runloop-client.ts";
import { applyStripeEvent } from "../../web/lib/billing/stripe.ts";
import { enforceBillingHold, provisionSeatComputers, resumeSeatComputers } from "../../web/lib/billing/lifecycle.ts";
import { DEFAULT_BILLING_GRACE_HOURS, graceExpired } from "../../web/lib/billing/grace.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { resetDeskRuntimeForTests, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import { paidCheckoutEvent, stripeEvent, TEST_PRICES, useTestPriceEnv } from "./helpers/stripe-fixtures.ts";

class CountingPlane implements RunloopControlPlane {
  readonly counts = { suspends: 0, shutdowns: 0, wakes: 0 };
  private readonly inner = new MemoryRunloopControlPlane();

  async create(params: RunloopCreateParams): Promise<RunloopDevboxSession> {
    return this.watch(await this.inner.create(params));
  }
  async get(id: string): Promise<RunloopDevboxSession> {
    return this.watch(await this.inner.get(id));
  }
  async restore(snapshotRef: string, params: RunloopCreateParams): Promise<RunloopDevboxSession> {
    return this.watch(await this.inner.restore(snapshotRef, params));
  }

  private watch(session: RunloopDevboxSession): RunloopDevboxSession {
    const counts = this.counts;
    const suspend = session.suspend.bind(session);
    const shutdown = session.shutdown.bind(session);
    const resume = session.resume.bind(session);
    session.suspend = async () => {
      counts.suspends += 1;
      await suspend();
    };
    session.shutdown = async () => {
      counts.shutdowns += 1;
      await shutdown();
    };
    session.resume = async () => {
      counts.wakes += 1;
      await resume();
    };
    return session;
  }
}

describe("billing grace keeps the disk", { concurrency: 1 }, () => {
  beforeEach(() => {
    useTestPriceEnv();
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
  });

  it("does not suspend during grace and never destroys on cancel", async () => {
    const plane = new CountingPlane();
    const service = new ComputerService(
      new RunloopProvider({ client: plane, blueprint: "flok-runloop-interactive", requireInteractive: false }),
    );
    setComputerServiceForTests(service);
    const paid = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_grace", email: "grace@example.com", eventId: "evt_g_paid" }),
    );
    assert.ok(paid);
    const computers = await provisionSeatComputers(paid);
    assert.equal(computers.length, 1);
    const computerId = computers[0]?.id ?? "";

    const canceled = await applyStripeEvent(
      stripeEvent(
        "customer.subscription.deleted",
        {
          id: "sub_cs_grace",
          status: "canceled",
          customer: "cus_cs_grace",
          items: { data: [{ price: { id: TEST_PRICES.personal }, quantity: 1 }] },
        },
        { id: "evt_g_del", created: 1_700_000_200 },
      ),
    );
    assert.equal(canceled?.status, "canceled");
    assert.ok(canceled?.graceUntil);
    assert.equal(graceExpired(canceled, 1_700_000_200 * 1000 + 60_000), false);
    await enforceBillingHold(canceled, 1_700_000_200 * 1000 + 60_000);
    assert.equal(plane.counts.suspends, 0);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal((await service.get(computerId)).state !== "deleted", true);

    const afterGrace = Date.parse(canceled.graceUntil ?? "") + 1_000;
    await enforceBillingHold(canceled, afterGrace);
    assert.equal(plane.counts.suspends >= 1, true);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal((await service.get(computerId)).state, "paused");
  });

  it("resumes a paused computer after a successful payment", async () => {
    const plane = new CountingPlane();
    const service = new ComputerService(
      new RunloopProvider({ client: plane, blueprint: "flok-runloop-interactive", requireInteractive: false }),
    );
    setComputerServiceForTests(service);
    const seat = await getSeatStore().upsert(
      createSeat({
        email: "resume@example.com",
        plan: "personal",
        stripeCustomerId: "cus_resume",
        stripeSubscriptionId: "sub_resume",
        status: "active",
      }),
    );
    const computers = await provisionSeatComputers(seat);
    const computerId = computers[0]?.id ?? "";
    assert.ok(computerId);
    const held = await getSeatStore().upsert({
      ...(await getSeatStore().getById(seat.id))!,
      status: "past_due",
      graceUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    await enforceBillingHold(held, Date.now());
    assert.equal((await service.get(computerId)).state, "paused");

    const paid = await applyStripeEvent(
      stripeEvent(
        "invoice.paid",
        { subscription: "sub_resume", customer: "cus_resume" },
        { id: "evt_resume_paid", created: Math.floor(Date.now() / 1000) },
      ),
    );
    assert.equal(paid?.status, "active");
    await resumeSeatComputers(paid ?? seat);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal((await service.get(computerId)).state === "running" || (await service.get(computerId)).state === "ready", true);
  });

  it("defaults grace to 72 hours", () => {
    assert.equal(DEFAULT_BILLING_GRACE_HOURS, 72);
  });
});
