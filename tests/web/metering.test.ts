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

  it("suspends canceled or past-due seats only after grace", () => {
    const canceled = createSeat({
      email: "x@example.com",
      plan: "personal",
      stripeCustomerId: "cus_x",
      status: "canceled",
      graceUntil: "2026-09-29T00:00:00.000Z",
    });
    assert.equal(
      decideMetering({
        seat: canceled,
        computerState: "running",
        lastActiveAt: "2026-09-28T00:00:00.000Z",
        nowMs: Date.parse("2026-09-28T12:00:00.000Z"),
      }).action,
      "none",
    );
    const after = decideMetering({
      seat: canceled,
      computerState: "running",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs: Date.parse("2026-09-29T00:00:01.000Z"),
    });
    assert.equal(after.action, "suspend");
    if (after.action === "suspend") assert.equal(after.reason, "canceled");
    const pastDue = { ...canceled, status: "past_due" as const };
    const past = decideMetering({
      seat: pastDue,
      computerState: "paused",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs: Date.parse("2026-09-29T00:00:01.000Z"),
    });
    assert.equal(past.action, "none");
  });

  it("meters by runtime state only, ignoring a leftover rebuild flag", () => {
    const seat = createSeat({
      email: "rebuild@example.com",
      plan: "personal",
      stripeCustomerId: "cus_r",
      lastMeteredAt: "2026-09-28T00:00:00.000Z",
    });
    const nowMs = Date.parse("2026-09-28T01:00:00.000Z");
    const ready = decideMetering({
      seat,
      computerState: "ready",
      lastActiveAt: "2026-09-28T00:30:00.000Z",
      nowMs,
      idleMinutes: 180,
    });
    assert.equal(ready.action, "meter");
    if (ready.action === "meter") assert.equal(ready.addSeconds, 3600);

    const waking = decideMetering({
      seat,
      computerState: "waking",
      lastActiveAt: "2026-09-28T00:30:00.000Z",
      nowMs,
      idleMinutes: 180,
    });
    assert.equal(waking.action, "meter");

    const parked = decideMetering({
      seat,
      computerState: "stopped",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs,
    });
    assert.equal(parked.action, "none");

    const idleReady = decideMetering({
      seat,
      computerState: "ready",
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs,
      idleMinutes: 30,
    });
    assert.equal(idleReady.action, "suspend");
    if (idleReady.action === "suspend") assert.equal(idleReady.reason, "idle");
  });
});
