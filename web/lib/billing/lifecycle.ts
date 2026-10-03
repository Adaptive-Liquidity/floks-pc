import type { Computer } from "../../../src/lib/computers/index";
import { idleMinutesFromEnv } from "./catalog";
import {
  applyMeteredSeconds,
  decideMetering,
  hoursFromSeconds,
} from "./metering";
import { getOauthStore } from "../oauth";
import { getSeatStore, type SeatRecord } from "./seats";
import { withSeatProvisionLock } from "./provision-lock";
import { graceExpired, startGrace } from "./grace";
import {
  ensureComputersForSeat,
  getComputerService,
  paidProviderForbiddenMessage,
  pauseComputer,
  pingKeepAlive,
  resumeComputer,
  revokeSeatPairing,
  shutdownComputer,
  webProviderName,
} from "../desks/runtime";

export { paidProviderForbiddenMessage };

export type MaintenanceRow = {
  seatId: string;
  computerId: string | null;
  action: string;
  reason?: string;
  addSeconds?: number;
};

export function isProductionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function assertPaidProviderAllowed(
  seat: Pick<SeatRecord, "status">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (seat.status === "canceled") return;
  if (env.NODE_ENV === "test") return;
  if (!isProductionLike(env)) return;
  if (webProviderName() !== "runloop") {
    throw new Error(paidProviderForbiddenMessage());
  }
}

export async function provisionSeatComputers(seat: SeatRecord): Promise<Computer[]> {
  if (seat.status !== "active") return [];
  return withSeatProvisionLock(seat.id, async () => {
    const fresh = (await getSeatStore().getById(seat.id)) ?? seat;
    if (fresh.status !== "active") return [];
    assertPaidProviderAllowed(fresh);
    return ensureComputersForSeat(fresh);
  });
}

export async function resumeSeatComputers(seat: SeatRecord): Promise<number> {
  if (seat.status !== "active") return 0;
  const ids = uniqueComputerIds(seat);
  let n = 0;
  for (const id of ids) {
    try {
      await resumeComputer(id);
      n += 1;
    } catch (err) {
      console.error("[seat.resume]", err instanceof Error ? err.message : err);
    }
  }
  return n;
}

/** After grace: suspend and keep files. Never destroy from billing. Preview does not need cron. */
export async function enforceBillingHold(seat: SeatRecord, nowMs: number = Date.now()): Promise<SeatRecord> {
  const store = getSeatStore();
  if (seat.status === "active") {
    if (!seat.graceUntil) return seat;
    return store.upsert({ ...seat, graceUntil: null });
  }
  let current = seat;
  if (!current.graceUntil) {
    current = await store.upsert(startGrace(current, nowMs));
  }
  if (!graceExpired(current, nowMs)) return current;
  for (const id of uniqueComputerIds(current)) {
    try {
      await pauseComputer(id);
    } catch (err) {
      console.error("[seat.hold]", err instanceof Error ? err.message : err);
    }
  }
  return current;
}

export async function shutdownSeatComputers(
  seat: SeatRecord,
  mode: "stop" | "destroy" = "stop",
): Promise<number> {
  if (seat.status === "canceled") {
    const ids = uniqueComputerIds(seat);
    for (const id of ids) {
      try {
        await (await getComputerService()).revokeBoundComputer(id);
      } catch (err) {
        console.error("[seat.cancel]", err instanceof Error ? err.message : err);
      }
      await getOauthStore().revokeComputerTokens(id);
    }
    await revokeSeatPairing(seat);
  }
  const ids = uniqueComputerIds(seat);
  let n = 0;
  for (const id of ids) {
    await shutdownComputer(id, seat.status === "canceled" ? "destroy" : mode);
    n += 1;
  }
  return n;
}

export async function runComputerMaintenance(nowMs: number = Date.now()): Promise<{
  scanned: number;
  rows: MaintenanceRow[];
}> {
  const store = getSeatStore();
  const seats = await store.listAll();
  const service = await getComputerService();
  const idleMinutes = idleMinutesFromEnv();
  const nowIso = new Date(nowMs).toISOString();
  const rows: MaintenanceRow[] = [];

  for (const seat of seats) {
    if (seat.status === "canceled" || seat.status === "past_due") {
      const held = await enforceBillingHold(seat, nowMs);
      const ids = uniqueComputerIds(held);
      const expired = graceExpired(held, nowMs);
      if (ids.length === 0) {
        rows.push({
          seatId: seat.id,
          computerId: null,
          action: expired ? "none" : "grace",
          reason: expired ? "no_computer" : seat.status,
        });
        continue;
      }
      for (const computerId of ids) {
        rows.push({
          seatId: seat.id,
          computerId,
          action: expired ? "suspend" : "grace",
          reason: seat.status,
        });
      }
      continue;
    }
    const ids = uniqueComputerIds(seat);
    if (ids.length === 0 && seat.status === "active") {
      try {
        const created = await provisionSeatComputers(seat);
        for (const computer of created) {
          rows.push({ seatId: seat.id, computerId: computer.id, action: "provision" });
        }
      } catch (err) {
        rows.push({
          seatId: seat.id,
          computerId: null,
          action: "provision_failed",
          reason: err instanceof Error ? err.message : "provision_failed",
        });
      }
      continue;
    }

    let nextSeat = seat;
    for (const computerId of ids) {
      let computer: Computer | null = null;
      try {
        computer = await service.get(computerId);
      } catch {
        computer = null;
      }
      const lastActiveAt = computer?.lastActiveAt?.toISOString() ?? null;
      const decision = decideMetering({
        seat: nextSeat,
        computerState: computer?.state ?? null,
        lastActiveAt,
        nowMs,
        idleMinutes,
      });

      if (decision.action === "meter" || decision.action === "suspend") {
        nextSeat = applyMeteredSeconds(nextSeat, decision.addSeconds, nowIso);
      } else if (decision.action === "none" && nextSeat.lastMeteredAt !== nowIso) {
        nextSeat = { ...nextSeat, lastMeteredAt: nowIso, hoursUsed: hoursFromSeconds(nextSeat.secondsUsed) };
      }

      if (decision.action === "suspend" && computer) {
        await pauseComputer(computer.id);
      }
      if (decision.action === "shutdown" && computer) {
        await pauseComputer(computer.id);
      }
      if (
        (decision.action === "meter" || decision.action === "none") &&
        computer &&
        (computer.state === "running" || computer.state === "ready")
      ) {
        await pingKeepAlive(computer.id);
      }

      const row: MaintenanceRow = {
        seatId: seat.id,
        computerId,
        action: decision.action,
        addSeconds: "addSeconds" in decision ? decision.addSeconds : 0,
      };
      if ("reason" in decision) row.reason = decision.reason;
      rows.push(row);
    }
    if (nextSeat !== seat) {
      await store.upsert(nextSeat);
    }
  }

  return { scanned: seats.length, rows };
}

function uniqueComputerIds(seat: SeatRecord): string[] {
  const ids = [...seat.computerIds];
  if (seat.computerId && !ids.includes(seat.computerId)) ids.unshift(seat.computerId);
  return [...new Set(ids.filter(Boolean))];
}
