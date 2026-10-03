import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, MemoryRunloopControlPlane, RunloopProvider } from "../../src/lib/computers/index.ts";
import type {
  RunloopControlPlane,
  RunloopCreateParams,
  RunloopDevboxSession,
} from "../../src/lib/computers/providers/runloop-client.ts";
import { runComputerMaintenance } from "../../web/lib/billing/lifecycle.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { resetDeskRuntimeForTests, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";

class CountingPlane implements RunloopControlPlane {
  readonly counts = { suspends: 0, shutdowns: 0 };
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
    session.suspend = async () => {
      counts.suspends += 1;
      await suspend();
    };
    session.shutdown = async () => {
      counts.shutdowns += 1;
      await shutdown();
    };
    return session;
  }
}

function providerFor(plane: CountingPlane): RunloopProvider {
  return new RunloopProvider({
    client: plane,
    blueprint: "flok-runloop-interactive",
    requireInteractive: false,
  });
}

describe("idle suspend keeps the disk", () => {
  it("idle and out-of-hours call suspend, not shutdown", async () => {
    resetDeskRuntimeForTests();
    resetSeatStoreForTests();
    const started = Date.parse("2026-09-28T00:00:00.000Z");
    let now = started;
    const plane = new CountingPlane();
    const service = new ComputerService(providerFor(plane), { now: () => now });
    setComputerServiceForTests(service);
    const idleComputer = await service.requestComputer({ birdId: "bird-idle", flockId: "flock-idle" });
    await getSeatStore().upsert(
      createSeat({
        email: "idle@example.com",
        plan: "personal",
        stripeCustomerId: "cus_idle",
        computerId: idleComputer.id,
        computerIds: [idleComputer.id],
        secondsUsed: 0,
        lastMeteredAt: new Date(started).toISOString(),
      }),
    );
    await runComputerMaintenance(started + 45 * 60 * 1000);
    assert.equal(plane.counts.suspends, 1);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal((await service.get(idleComputer.id)).state, "paused");

    const hoursComputer = await service.requestComputer({ birdId: "bird-hours", flockId: "flock-hours" });
    now = started + 60 * 1000;
    await getSeatStore().upsert(
      createSeat({
        email: "hours@example.com",
        plan: "personal",
        stripeCustomerId: "cus_hours",
        computerId: hoursComputer.id,
        computerIds: [hoursComputer.id],
        secondsUsed: 10 * 3600,
        lastMeteredAt: new Date(now).toISOString(),
      }),
    );
    await runComputerMaintenance(now + 60 * 1000);
    assert.equal(plane.counts.suspends, 2);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal((await service.get(hoursComputer.id)).state, "paused");
  });

  it("cancel suspends after grace and never deletes immediately", async () => {
    resetDeskRuntimeForTests();
    resetSeatStoreForTests();
    const plane = new CountingPlane();
    const service = new ComputerService(providerFor(plane));
    setComputerServiceForTests(service);
    const computer = await service.requestComputer({ birdId: "bird-cancel", flockId: "flock-cancel" });
    const now = Date.now();
    await getSeatStore().upsert(
      createSeat({
        email: "cancel@example.com",
        plan: "personal",
        stripeCustomerId: "cus_cancel",
        status: "canceled",
        computerId: computer.id,
        computerIds: [computer.id],
        graceUntil: new Date(now + 60_000).toISOString(),
      }),
    );
    await runComputerMaintenance(now);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal(plane.counts.suspends, 0);
    await getSeatStore().upsert({
      ...(await getSeatStore().listByEmail("cancel@example.com"))[0]!,
      graceUntil: new Date(now - 1_000).toISOString(),
    });
    await runComputerMaintenance(now);
    assert.equal(plane.counts.suspends >= 1, true);
    assert.equal(plane.counts.shutdowns, 0);
    assert.equal((await service.get(computer.id)).state, "paused");
  });
});
