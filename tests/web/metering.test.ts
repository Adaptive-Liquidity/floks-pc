import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSeat } from "../../web/lib/billing/seats.ts";
import {
  applyMeteredSeconds,
  decideMetering,
  hoursFromSeconds,
  shouldSuspendForCap,
  shouldSuspendForIdle,
} from "../../web/lib/billing/metering.ts";

describe("usage metering and suspend", () => {
  it("adds running seconds and suspends at the included-hour cap when overage is off", () => {
    const seat = createSeat({
      email: "meter@example.com",
      plan: "personal",
      stripeCustomerId: "cus_m",
      secondsUsed: 9 * 3600,
      lastMeteredAt: "2026-09-28T00:00:00.000Z",
    });
    assert.equal(seat.hoursIncluded, 10);
    assert.equal(shouldSuspendForCap(seat), false);
    const decision = decideMetering({
      seat,
      computerState: "running",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs: Date.parse("2026-09-28T02:00:00.000Z"),
      idleMinutes: 180,
    });
    assert.equal(decision.action, "suspend");
    if (decision.action === "suspend") {
      assert.equal(decision.reason, "hours_empty");
      assert.equal(decision.addSeconds, 2 * 3600);
      const next = applyMeteredSeconds(seat, decision.addSeconds, "2026-09-28T02:00:00.000Z");
      assert.ok(next.secondsUsed >= 10 * 3600);
      assert.equal(shouldSuspendForCap(next), true);
      assert.equal(hoursFromSeconds(next.secondsUsed) >= 10, true);
    }
  });

  it("does not cap-suspend when overage is enabled", () => {
    const seat = createSeat({
      email: "over@example.com",
      plan: "personal",
      stripeCustomerId: "cus_o",
      secondsUsed: 12 * 3600,
      overageEnabled: true,
      lastMeteredAt: "2026-09-28T00:00:00.000Z",
    });
    const decision = decideMetering({
      seat,
      computerState: "running",
      lastActiveAt: "2026-09-28T01:50:00.000Z",
      nowMs: Date.parse("2026-09-28T02:00:00.000Z"),
      idleMinutes: 30,
    });
    assert.equal(decision.action, "meter");
  });

  it("suspends after the configured idle period", () => {
    assert.equal(
      shouldSuspendForIdle({
        lastActiveAt: "2026-09-28T00:00:00.000Z",
        nowMs: Date.parse("2026-09-28T00:31:00.000Z"),
        idleMinutes: 30,
      }),
      true,
    );
    const seat = createSeat({
      email: "idle@example.com",
      plan: "pro",
      stripeCustomerId: "cus_i",
      lastMeteredAt: "2026-09-28T00:00:00.000Z",
    });
    const decision = decideMetering({
      seat,
      computerState: "ready",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs: Date.parse("2026-09-28T00:45:00.000Z"),
      idleMinutes: 30,
    });
    assert.equal(decision.action, "suspend");
    if (decision.action === "suspend") assert.equal(decision.reason, "idle");
  });

  it("shuts down canceled or past-due seats", () => {
    const canceled = createSeat({
      email: "x@example.com",
      plan: "personal",
      stripeCustomerId: "cus_x",
      status: "canceled",
    });
    assert.equal(
      decideMetering({
        seat: canceled,
        computerState: "running",
        lastActiveAt: "2026-09-28T00:00:00.000Z",
        nowMs: Date.now(),
      }).action,
      "shutdown",
    );
    const pastDue = { ...canceled, status: "past_due" as const };
    const past = decideMetering({
      seat: pastDue,
      computerState: "paused",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs: Date.now(),
    });
    assert.equal(past.action, "shutdown");
    if (past.action === "shutdown") assert.equal(past.reason, "past_due");
  });

  it("does not meter a refused rebuild, even if the stored state is still waking", () => {
    const seat = createSeat({
      email: "rebuild@example.com",
      plan: "personal",
      stripeCustomerId: "cus_r",
      lastMeteredAt: "2026-09-28T00:00:00.000Z",
    });
    const nowMs = Date.parse("2026-09-28T01:00:00.000Z");
    const stuckWake = decideMetering({
      seat,
      computerState: "waking",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs,
      rebuildConfirmRequired: true,
    });
    assert.equal(stuckWake.action, "none");
    if (stuckWake.action === "none") assert.equal(stuckWake.reason, "not_billable");

    const parked = decideMetering({
      seat,
      computerState: "stopped",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs,
      rebuildConfirmRequired: true,
    });
    assert.equal(parked.action, "none");

    const liveWake = decideMetering({
      seat,
      computerState: "waking",
      lastActiveAt: "2026-09-28T00:30:00.000Z",
      nowMs,
      idleMinutes: 180,
      rebuildConfirmRequired: false,
    });
    assert.equal(liveWake.action, "meter");
    if (liveWake.action === "meter") assert.equal(liveWake.addSeconds, 3600);
  });
});
