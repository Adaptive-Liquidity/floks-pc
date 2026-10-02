import { createHash } from "node:crypto";
import {
  ComputerService,
  FakeProvider,
  MemoryControlPlaneStore,
  controlPlaneStoreFromEnv,
  hashPairCode,
} from "../../../src/lib/computers/index";
import type { Computer, ComputerPairCode, ComputerProvider } from "../../../src/lib/computers/index";
import { getSeatStore, type SeatRecord } from "../billing/seats";
import { webControlPlaneStore } from "../store/control-plane-pg";
import { mapComputerState } from "./map-state";
import { MemoryPairRevealStore, PostgresPairRevealStore, type PairRevealStore } from "./reveal-store";
import type { DeskRecord } from "../types";

export function paidProviderForbiddenMessage(): string {
  return "Paid Staxions computers require FLOK_WEB_PROVIDER=runloop, RUNLOOP_API_KEY, and FLOK_RUNLOOP_BLUEPRINT. The demo provider cannot be served to a paying customer in production.";
}

const globalDesk = globalThis as typeof globalThis & {
  __staxDeskService?: Promise<ComputerService> | null;
  __staxReveal?: PairRevealStore | null;
  __staxRevealInjected?: PairRevealStore | null;
};
let memoryPlane: MemoryControlPlaneStore | null = null;

function sharedMemoryPlane(): MemoryControlPlaneStore {
  if (!memoryPlane) memoryPlane = new MemoryControlPlaneStore();
  return memoryPlane;
}

function getRevealStore(): PairRevealStore {
  if (globalDesk.__staxReveal) return globalDesk.__staxReveal;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  globalDesk.__staxReveal = databaseUrl ? new PostgresPairRevealStore(databaseUrl) : new MemoryPairRevealStore();
  return globalDesk.__staxReveal;
}

export function useRunloop(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FLOK_WEB_PROVIDER !== "runloop") return false;
  if (env.CI === "true" || env.NODE_ENV === "test") return false;
  return Boolean(env.RUNLOOP_API_KEY?.trim() && env.FLOK_RUNLOOP_BLUEPRINT?.trim());
}

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

async function createProvider(): Promise<ComputerProvider> {
  if (useRunloop()) {
    const { RunloopProvider } = await import("../../../src/lib/computers/index");
    return RunloopProvider.fromEnv();
  }
  return new FakeProvider();
}

export async function getComputerService(): Promise<ComputerService> {
  if (!globalDesk.__staxDeskService) {
    globalDesk.__staxDeskService = (async () => {
      const provider = await createProvider();
      const store =
        webControlPlaneStore(process.env, provider.name) ??
        controlPlaneStoreFromEnv(process.env, provider.name) ??
        sharedMemoryPlane();
      const service = new ComputerService(provider, { store });
      await service.hydrate();
      return service;
    })();
  }
  return globalDesk.__staxDeskService;
}

export function setPairRevealStoreForTests(store: PairRevealStore | null): void {
  globalDesk.__staxRevealInjected = store;
  globalDesk.__staxReveal = store;
}

export function setComputerServiceForTests(service: ComputerService | null): void {
  globalDesk.__staxDeskService = service ? Promise.resolve(service) : null;
}

export function resetDeskRuntimeForTests(): void {
  globalDesk.__staxDeskService = null;
  globalDesk.__staxReveal = globalDesk.__staxRevealInjected ?? new MemoryPairRevealStore();
}

export function birdIdForSeat(seat: SeatRecord, index = 0): string {
  return index === 0 ? `seat:${seat.id}` : `seat:${seat.id}:${index}`;
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
  deskId: string,
  revealed: { code: string; pairCodeId: string } | null,
): DeskRecord {
  const unusedOpen = codes.find((rec) => rec.usedAt === null && rec.expiresAt.getTime() > Date.now());
  const state = mapComputerState({
    computerState: computer?.state ?? null,
    pairStatus,
    hoursUsed: seat.hoursUsed,
    hoursIncluded: seat.hoursIncluded,
    seatStatus: seat.status,
  });
  const revealedCode = revealed?.code ?? null;
  return {
    id: deskId,
    state,
    userCode: revealedCode,
    pendingRequest: pairStatus === "pairing",
    pairKeyId: unusedOpen?.id ?? revealed?.pairCodeId ?? null,
    hoursUsed: seat.hoursUsed,
    hoursIncluded: seat.hoursIncluded,
    computerId: computer?.id ?? seat.computerId,
  };
}

export async function desksForSeats(seats: SeatRecord[]): Promise<DeskRecord[]> {
  const service = await getComputerService();
  await service.reloadIfRevisionChanged();
  const out: DeskRecord[] = [];
  for (const seat of seats) {
    const slots = Math.max(1, seat.maxComputers || 1);
    if (seat.status === "canceled" && !seat.computerId && seat.computerIds.length === 0) {
      out.push(toDesk(seat, null, [], "unpaired", seat.id, await liveReveal(seat.id, [])));
      continue;
    }
    for (let i = 0; i < slots; i++) {
      const knownId = seat.computerIds[i] ?? (i === 0 ? seat.computerId : null);
      const computer =
        (knownId ? await safeGet(service, knownId) : null) ??
        (await service.getByBird(birdIdForSeat(seat, i)));
      const codes = computer ? service.listPairCodes(computer.id) : [];
      const pairStatus = computer ? service.pairStatus(computer.id) : "unpaired";
      out.push(
        toDesk(
          seat,
          computer,
          codes,
          pairStatus,
          i === 0 ? seat.id : `${seat.id}:${i}`,
          i === 0 ? await liveReveal(seat.id, codes) : null,
        ),
      );
    }
  }
  return out;
}

async function liveReveal(
  seatId: string,
  codes: ComputerPairCode[],
): Promise<{ code: string; pairCodeId: string } | null> {
  const revealed = await getRevealStore().get(seatId);
  if (!revealed) return null;
  const match = codes.find((rec) => rec.id === revealed.pairCodeId);
  if (!match || match.usedAt !== null || match.expiresAt.getTime() <= Date.now()) {
    await getRevealStore().delete(seatId);
    return null;
  }
  return revealed;
}

async function safeGet(service: ComputerService, id: string): Promise<Computer | null> {
  try {
    return await service.get(id);
  } catch {
    return null;
  }
}

export async function ensureComputersForSeat(seat: SeatRecord): Promise<Computer[]> {
  if (isProductionRuntime() && seat.status === "active" && !useRunloop()) {
    throw new Error(paidProviderForbiddenMessage());
  }
  const service = await getComputerService();
  const wanted = Math.max(1, seat.maxComputers || 1);
  const computers: Computer[] = [];
  for (let i = 0; i < wanted; i++) {
    const knownId = seat.computerIds[i] ?? (i === 0 ? seat.computerId : null);
    const existing =
      (knownId ? await safeGet(service, knownId) : null) ??
      (await service.getByBird(birdIdForSeat(seat, i))) ??
      (i === 0 ? await service.getByBird(birdIdForSeat(seat)) : null);
    if (existing) {
      computers.push(existing);
      continue;
    }
    const created = await service.requestComputer({
      birdId: birdIdForSeat(seat, i),
      flockId: flockIdForEmail(seat.email),
    });
    computers.push(created);
  }
  const ensured = computers.map((row) => row.id);
  const store = getSeatStore();
  const fresh = (await store.getById(seat.id)) ?? seat;
  const computerIds = [...ensured];
  for (const id of fresh.computerIds) {
    if (id && !computerIds.includes(id)) computerIds.push(id);
  }
  const computerId = computerIds[0] ?? fresh.computerId ?? null;
  const changed = computerIds.join("\0") !== fresh.computerIds.join("\0") || computerId !== fresh.computerId;
  if (changed) {
    await store.upsert({
      ...fresh,
      computerId,
      computerIds,
    });
  }
  return computers;
}

export async function ensureComputer(seat: SeatRecord): Promise<Computer> {
  const [first] = await ensureComputersForSeat(seat);
  if (!first) throw new Error("Could not provision a computer for this seat.");
  return first;
}

export async function issuePairKey(seat: SeatRecord): Promise<{ code: string; expiresAt: Date; computerId: string }> {
  const service = await getComputerService();
  await service.reloadIfRevisionChanged();
  const computer = await ensureComputer(seat);
  const issued = await service.issuePairCode(computer.id);
  await getRevealStore().put(seat.id, { code: issued.code, pairCodeId: issued.id });
  return { code: issued.code, expiresAt: issued.expiresAt, computerId: computer.id };
}

export async function revokeSeatPairing(seat: SeatRecord): Promise<void> {
  const service = await getComputerService();
  await service.reloadIfRevisionChanged();
  await getRevealStore().delete(seat.id);
  const ids = new Set<string>(seat.computerIds.filter(Boolean));
  if (seat.computerId) ids.add(seat.computerId);
  if (ids.size === 0) {
    const computer = await service.getByBird(birdIdForSeat(seat));
    if (computer) await service.revokeUnusedPairCodes(computer.id);
    return;
  }
  for (const id of ids) {
    await service.revokeUnusedPairCodes(id);
  }
}

export async function revokePairKey(seat: SeatRecord): Promise<number> {
  const service = await getComputerService();
  await service.reloadIfRevisionChanged();
  const computer =
    (seat.computerId ? await safeGet(service, seat.computerId) : null) ??
    (await service.getByBird(birdIdForSeat(seat)));
  await getRevealStore().delete(seat.id);
  if (!computer) return 0;
  return service.revokeUnusedPairCodes(computer.id);
}

export async function approvePairCode(seat: SeatRecord, presented: string): Promise<"ok" | "mismatch"> {
  const service = await getComputerService();
  await service.reloadIfRevisionChanged();
  const computer =
    (seat.computerId ? await safeGet(service, seat.computerId) : null) ??
    (await service.getByBird(birdIdForSeat(seat)));
  if (!computer) return "mismatch";
  const digest = hashPairCode(presented);
  const open = service
    .listPairCodes(computer.id)
    .find((rec) => rec.usedAt === null && rec.expiresAt.getTime() > Date.now() && rec.codeDigest === digest);
  if (!open) return "mismatch";
  await getRevealStore().delete(seat.id);
  return "ok";
}

export async function consumeRevealedCode(seatId: string): Promise<string | null> {
  return (await getRevealStore().get(seatId))?.code ?? null;
}

export function webProviderName(): "fake" | "runloop" {
  return useRunloop() ? "runloop" : "fake";
}

export async function pauseComputer(computerId: string): Promise<void> {
  const service = await getComputerService();
  await service.pauseThisComputer(computerId);
}

export async function shutdownComputer(
  computerId: string,
  mode: "stop" | "destroy" = "stop",
): Promise<void> {
  const service = await getComputerService();
  if (mode === "destroy") {
    const computer = await safeGet(service, computerId);
    if (computer?.providerRef) {
      await service.destroyThisComputer(computer.id, {
        confirm: true,
        providerRef: computer.providerRef,
      });
      return;
    }
  }
  try {
    await service.stopThisComputer(computerId);
  } catch {
    const computer = await safeGet(service, computerId);
    if (computer?.providerRef) {
      await service.destroyThisComputer(computer.id, {
        confirm: true,
        providerRef: computer.providerRef,
      });
    }
  }
}

export async function pingKeepAlive(computerId: string): Promise<void> {
  const service = await getComputerService();
  await service.refreshKeepAlive(computerId);
}
