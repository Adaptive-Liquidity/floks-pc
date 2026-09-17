import { createHash } from "node:crypto";
import {
  ComputerService,
  FakeProvider,
  controlPlaneStoreFromEnv,
  hashPairCode,
} from "../../../src/lib/computers/index";
import type { Computer, ComputerPairCode, ComputerProvider } from "../../../src/lib/computers/index";
import { getSeatStore, type SeatRecord } from "../billing/seats";
import { mapComputerState } from "./map-state";
import type { DeskRecord } from "../types";

let servicePromise: Promise<ComputerService> | null = null;
let lastRevealed = new Map<string, { code: string; seatId: string }>();

function useRunloop(): boolean {
  if (process.env.FLOK_WEB_PROVIDER !== "runloop") return false;
  if (process.env.CI === "true" || process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.RUNLOOP_API_KEY?.trim() && process.env.FLOK_RUNLOOP_BLUEPRINT?.trim());
}

async function createProvider(): Promise<ComputerProvider> {
  if (useRunloop()) {
    const { RunloopProvider } = await import("../../../src/lib/computers/index");
    return RunloopProvider.fromEnv();
  }
  return new FakeProvider();
}

export async function getComputerService(): Promise<ComputerService> {
  if (!servicePromise) {
    servicePromise = (async () => {
      const provider = await createProvider();
      const store = controlPlaneStoreFromEnv(process.env, provider.name);
      const service = new ComputerService(provider, store ? { store } : undefined);
      await service.hydrate();
      return service;
    })();
  }
  return servicePromise;
}

export function resetDeskRuntimeForTests(): void {
  servicePromise = null;
  lastRevealed = new Map();
}

export function birdIdForSeat(seat: SeatRecord): string {
  return `seat:${seat.id}`;
}

export function flockIdForEmail(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `owner:${digest}`;
}

function toDesk(
  seat: SeatRecord,
  computer: Computer | null,
  codes: ComputerPairCode[],
  pairStatus: "unpaired" | "pairing" | "paired",
): DeskRecord {
  const unusedOpen = codes.find((rec) => rec.usedAt === null && rec.expiresAt.getTime() > Date.now());
  const state = mapComputerState({
    computerState: computer?.state ?? null,
    pairStatus,
    hoursUsed: seat.hoursUsed,
    hoursIncluded: seat.hoursIncluded,
    seatStatus: seat.status,
  });
  const revealed = lastRevealed.get(seat.id);
  return {
    id: seat.id,
    state,
    userCode: revealed?.code ?? null,
    pendingRequest: pairStatus === "pairing",
    pairKeyId: unusedOpen?.id ?? revealed?.seatId ?? null,
    hoursUsed: seat.hoursUsed,
    hoursIncluded: seat.hoursIncluded,
    computerId: computer?.id ?? seat.computerId,
  };
}

export async function desksForSeats(seats: SeatRecord[]): Promise<DeskRecord[]> {
  const service = await getComputerService();
  const out: DeskRecord[] = [];
  for (const seat of seats) {
    if (seat.status === "canceled" && !seat.computerId) {
      out.push(toDesk(seat, null, [], "unpaired"));
      continue;
    }
    const computer =
      (seat.computerId ? await safeGet(service, seat.computerId) : null) ??
      (await service.getByBird(birdIdForSeat(seat)));
    const codes = computer ? service.listPairCodes(computer.id) : [];
    const pairStatus = computer ? service.pairStatus(computer.id) : "unpaired";
    out.push(toDesk(seat, computer, codes, pairStatus));
  }
  return out;
}

async function safeGet(service: ComputerService, id: string): Promise<Computer | null> {
  try {
    return await service.get(id);
  } catch {
    return null;
  }
}

export async function ensureComputer(seat: SeatRecord): Promise<Computer> {
  const service = await getComputerService();
  const existing =
    (seat.computerId ? await safeGet(service, seat.computerId) : null) ??
    (await service.getByBird(birdIdForSeat(seat)));
  if (existing) return existing;
  const created = await service.requestComputer({
    birdId: birdIdForSeat(seat),
    flockId: flockIdForEmail(seat.email),
  });
  const store = getSeatStore();
  await store.upsert({ ...seat, computerId: created.id });
  return created;
}

export async function issuePairKey(seat: SeatRecord): Promise<{ code: string; expiresAt: Date; computerId: string }> {
  const service = await getComputerService();
  const computer = await ensureComputer(seat);
  const issued = await service.issuePairCode(computer.id);
  lastRevealed.set(seat.id, { code: issued.code, seatId: issued.id });
  return { code: issued.code, expiresAt: issued.expiresAt, computerId: computer.id };
}

export async function revokePairKey(seat: SeatRecord): Promise<number> {
  const service = await getComputerService();
  const computer =
    (seat.computerId ? await safeGet(service, seat.computerId) : null) ??
    (await service.getByBird(birdIdForSeat(seat)));
  lastRevealed.delete(seat.id);
  if (!computer) return 0;
  return service.revokeUnusedPairCodes(computer.id);
}

export async function approvePairCode(seat: SeatRecord, presented: string): Promise<"ok" | "mismatch"> {
  const service = await getComputerService();
  const computer =
    (seat.computerId ? await safeGet(service, seat.computerId) : null) ??
    (await service.getByBird(birdIdForSeat(seat)));
  if (!computer) return "mismatch";
  const digest = hashPairCode(presented);
  const open = service
    .listPairCodes(computer.id)
    .find((rec) => rec.usedAt === null && rec.expiresAt.getTime() > Date.now() && rec.codeDigest === digest);
  return open ? "ok" : "mismatch";
}

export function consumeRevealedCode(seatId: string): string | null {
  return lastRevealed.get(seatId)?.code ?? null;
}

export function webProviderName(): "fake" | "runloop" {
  return useRunloop() ? "runloop" : "fake";
}
