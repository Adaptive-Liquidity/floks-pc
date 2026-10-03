import { graceAllowsAccess } from "../billing/grace";
import { shouldSuspendForCap } from "../billing/metering";
import { getSeatStore, type SeatRecord } from "../billing/seats";

export type WakeDecision =
  | { allow: true }
  | { allow: false; status: 402; reason: "grace_expired" | "hours_empty" };

function seatForComputer(
  seats: SeatRecord[],
  computerId: string,
): SeatRecord | undefined {
  return seats.find(
    (row) => row.computerId === computerId || row.computerIds.includes(computerId),
  );
}

/**
 * Single wake gate for screen, dashboard, and MCP.
 * In-grace seats wake; expired grace or an empty hour cap is 402.
 * Side-effect-free: never pause or take the computer lock.
 */
export function decideWakeAdmission(
  seat: Pick<
    SeatRecord,
    "status" | "graceUntil" | "hoursIncluded" | "secondsUsed" | "overageEnabled"
  >,
  nowMs: number = Date.now(),
): WakeDecision {
  if (!graceAllowsAccess(seat, nowMs)) {
    return { allow: false, status: 402, reason: "grace_expired" };
  }
  if (shouldSuspendForCap(seat)) {
    return { allow: false, status: 402, reason: "hours_empty" };
  }
  return { allow: true };
}

export async function decideComputerWake(
  computerId: string,
  nowMs: number = Date.now(),
): Promise<WakeDecision> {
  const seats = await getSeatStore().listAll();
  const seat = seatForComputer(seats, computerId);
  if (!seat) return { allow: true };
  return decideWakeAdmission(seat, nowMs);
}

/** Boolean contract used inside ComputerService. Must not pause or re-enter the computer lock. */
export async function admitComputerWake(
  computerId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  return (await decideComputerWake(computerId, nowMs)).allow;
}

/** One call per HTTP/screen path. Returns the 402 decision; the caller does not pause here. */
export async function requireWakeAdmission(
  computerId: string,
  nowMs: number = Date.now(),
): Promise<WakeDecision> {
  return decideComputerWake(computerId, nowMs);
}
