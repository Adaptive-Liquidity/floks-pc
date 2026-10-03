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

function seatComputerIds(seat: Pick<SeatRecord, "computerId" | "computerIds">): string[] {
  const ids = [...seat.computerIds];
  if (seat.computerId && !ids.includes(seat.computerId)) ids.unshift(seat.computerId);
  return [...new Set(ids.filter(Boolean))];
}

/** Single wake gate for screen, dashboard, and MCP. In-grace seats wake; expired grace is 402. */
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

/** Decide, hold expired-grace boxes, and return the same decision screen/dashboard/MCP use. */
export async function enforceComputerWake(
  computerId: string,
  nowMs: number = Date.now(),
): Promise<WakeDecision> {
  const seats = await getSeatStore().listAll();
  const seat = seatForComputer(seats, computerId);
  if (!seat) return { allow: true };
  const decision = decideWakeAdmission(seat, nowMs);
  if (!decision.allow && decision.reason === "grace_expired") {
    const { pauseComputer } = await import("./runtime");
    for (const id of seatComputerIds(seat)) {
      try {
        await pauseComputer(id);
      } catch {
        // Hold is best-effort; the caller still sees the 402/deny.
      }
    }
  }
  return decision;
}

export async function admitComputerWake(
  computerId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  return (await enforceComputerWake(computerId, nowMs)).allow;
}
