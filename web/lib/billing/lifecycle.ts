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
import {
  ensureComputersForSeat,
  getComputerService,
  paidProviderForbiddenMessage,
  pauseComputer,
  pingKeepAlive,
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
    const ids = uniqueComputerIds(seat);
    if (ids.length === 0 && (seat.status === "canceled" || seat.status === "past_due")) {
      rows.push({ seatId: seat.id, computerId: null, action: "none", reason: "no_computer" });
      continue;
    }
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
        rebuildConfirmRequired: computer?.rebuildConfirmRequired === true,
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
        await shutdownComputer(computer.id, decision.reason === "canceled" ? "destroy" : "stop");
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
