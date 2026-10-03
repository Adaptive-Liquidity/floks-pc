import {
  DEFAULT_IDLE_MINUTES,
  hoursForPurchase,
  type CheckoutPlanId,
} from "./catalog";
import type { SeatRecord, SeatStatus } from "./seats";

export type ComputerRuntimeState =
  | "running"
  | "ready"
  | "provisioning"
  | "waking"
  | "paused"
  | "stopped"
  | "deleted"
  | "error"
  | string;

export type MeterDecision =
  | { action: "none"; reason: "not_billable" | "already_stopped" }
  | { action: "meter"; addSeconds: number }
  | { action: "suspend"; reason: "hours_empty" | "idle"; addSeconds: number }
  | { action: "shutdown"; reason: "canceled" | "past_due" };

const BILLABLE = new Set(["running", "ready", "provisioning", "waking", "requested"]);

export function isBillableState(state: ComputerRuntimeState | null | undefined): boolean {
  if (!state) return false;
  return BILLABLE.has(state);
}

export function secondsBetween(fromIso: string | null | undefined, toMs: number): number {
  if (!fromIso) return 0;
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from) || toMs <= from) return 0;
  return Math.max(0, Math.floor((toMs - from) / 1000));
}

export function hoursFromSeconds(seconds: number): number {
  return seconds / 3600;
}

export function remainingHours(seat: Pick<SeatRecord, "hoursIncluded" | "secondsUsed">): number {
  return Math.max(0, seat.hoursIncluded - hoursFromSeconds(seat.secondsUsed));
}

export function includedHoursForSeat(plan: CheckoutPlanId, quantity: number): number {
  return hoursForPurchase(plan, quantity);
}

export function shouldSuspendForCap(
  seat: Pick<SeatRecord, "hoursIncluded" | "secondsUsed" | "overageEnabled">,
): boolean {
  if (seat.overageEnabled) return false;
  return seat.secondsUsed >= seat.hoursIncluded * 3600;
}

export function shouldSuspendForIdle(input: {
  lastActiveAt: string | null | undefined;
  nowMs: number;
  idleMinutes?: number;
}): boolean {
  const idleMinutes = input.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const last = input.lastActiveAt ? Date.parse(input.lastActiveAt) : NaN;
  if (!Number.isFinite(last)) return false;
  return input.nowMs - last >= idleMinutes * 60 * 1000;
}

export function decideMetering(input: {
  seat: Pick<
    SeatRecord,
    "status" | "hoursIncluded" | "secondsUsed" | "overageEnabled" | "lastMeteredAt"
  >;
  computerState: ComputerRuntimeState | null;
  lastActiveAt: string | null;
  nowMs: number;
  idleMinutes?: number;
}): MeterDecision {
  const status: SeatStatus = input.seat.status;
  if (status === "canceled") {
    return input.computerState && input.computerState !== "stopped" && input.computerState !== "deleted"
      ? { action: "shutdown", reason: "canceled" }
      : { action: "none", reason: "already_stopped" };
  }
  if (status === "past_due") {
    return input.computerState && input.computerState !== "stopped" && input.computerState !== "deleted"
      ? { action: "shutdown", reason: "past_due" }
      : { action: "none", reason: "already_stopped" };
  }

  const metered = isBillableState(input.computerState);
  const addSeconds = metered ? secondsBetween(input.seat.lastMeteredAt, input.nowMs) : 0;
  const nextUsed = input.seat.secondsUsed + addSeconds;
  const nextSeat = { ...input.seat, secondsUsed: nextUsed };

  if (shouldSuspendForCap(nextSeat) && metered) {
    return { action: "suspend", reason: "hours_empty", addSeconds };
  }
  const idleInput: { lastActiveAt: string | null; nowMs: number; idleMinutes?: number } = {
    lastActiveAt: input.lastActiveAt ?? input.seat.lastMeteredAt,
    nowMs: input.nowMs,
  };
  if (input.idleMinutes !== undefined) idleInput.idleMinutes = input.idleMinutes;
  if (metered && shouldSuspendForIdle(idleInput)) {
    return { action: "suspend", reason: "idle", addSeconds };
  }
  if (addSeconds > 0) return { action: "meter", addSeconds };
  return { action: "none", reason: "not_billable" };
}

export function applyMeteredSeconds(
  seat: SeatRecord,
  addSeconds: number,
  nowIso: string,
): SeatRecord {
  const secondsUsed = Math.max(0, seat.secondsUsed + Math.max(0, addSeconds));
  return {
    ...seat,
    secondsUsed,
    hoursUsed: hoursFromSeconds(secondsUsed),
    lastMeteredAt: nowIso,
  };
}

export function resetUsageForNewPeriod(seat: SeatRecord, periodStart: string | null): SeatRecord {
  if (periodStart && seat.periodStart === periodStart) return seat;
  return {
    ...seat,
    periodStart,
    secondsUsed: 0,
    hoursUsed: 0,
    lastMeteredAt: new Date().toISOString(),
  };
}
