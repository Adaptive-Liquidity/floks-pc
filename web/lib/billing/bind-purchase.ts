import type Stripe from "stripe";
import type { Computer } from "../../../src/lib/computers/index";
import { flockIdForEmail, getComputerService } from "../desks/runtime";
import { getOauthStore } from "../oauth";
import { enforceBillingHold, provisionSeatComputers } from "./lifecycle";
import { computerIdsForEmail, getPendingBindStore } from "./pending-binds";
import { getSeatStore, type SeatRecord } from "./seats";

/** Mint a capability for a computer this flock already owns. The raw token is not stored. */
export async function issueBoundCapability(
  computerId: string,
  flock: string,
  clientId: string,
): Promise<{ capabilityId: string; computerHandle: string }> {
  const client = await getOauthStore().getClient(clientId);
  if (!client) throw new Error("oauth client missing");
  const issued = await (await getComputerService()).issueBoundCapability(computerId, flock);
  return { capabilityId: issued.capabilityId, computerHandle: issued.computerHandle };
}

export type BindOutcome =
  | { ok: true }
  | { ok: false; kind: "none" }
  | { ok: false; kind: "transient"; reason: string }
  | {
      ok: false;
      kind: "permanent";
      reason: "expired" | "mismatch" | "used" | "missing" | "no_live_token" | "held";
    };

function permanent(
  reason: Extract<BindOutcome, { kind: "permanent" }>["reason"],
): BindOutcome {
  return { ok: false, kind: "permanent", reason };
}

/**
 * After the seat's computer exists, attach it to the Bot that started checkout.
 * Permanent nonce/login failures keep the computer for /setup reconnect.
 */
export async function bindPurchasedComputer(
  event: Stripe.Event,
  seat: SeatRecord,
  computers: Computer[],
): Promise<BindOutcome> {
  if (event.type !== "checkout.session.completed") return { ok: false, kind: "none" };
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata ?? {};
  const nonce = meta.bind_nonce?.trim() ?? "";
  if (!nonce) return { ok: false, kind: "none" };
  const subject = meta.subject?.trim() ?? "";
  const flock = meta.flock?.trim() ?? "";
  const clientId = meta.oauth_client_id?.trim() ?? "";
  const pending = await getPendingBindStore().get(nonce);
  if (!pending) return permanent("missing");
  if (pending.subject !== subject || pending.flock !== flock || pending.clientId !== clientId) {
    return permanent("mismatch");
  }
  if (pending.flock !== flockIdForEmail(seat.email)) return permanent("mismatch");
  const live = computers.length > 0 ? computers : await computersForSeat(seat);
  if (await alreadyBoundToSeat(pending, seat, live)) {
    if (pending.usedAt === null) await getPendingBindStore().markUsed(nonce);
    return { ok: true };
  }
  if (pending.failedAt !== null) return { ok: false, kind: "none" };
  if (pending.usedAt !== null) return permanent("used");
  if (pending.openedAt !== null && pending.openedAt > pending.expiresAt) return permanent("expired");
  if (pending.openedAt === null && pending.expiresAt <= Date.now()) return permanent("expired");
  if (live.length === 0) {
    return { ok: false, kind: "transient", reason: "computer_missing" };
  }
  const service = await getComputerService();
  if (process.env.FLOK_PER_BOT_KEYS === "true") {
    const open = live.find((row) => row.flockId === pending.flock && !service.liveBotKey(row.id));
    if (!open) return permanent("held");
    try {
      const attached = await service.attachPurchaseToClaim(nonce, open.id);
      if (!attached) return permanent("mismatch");
      await getPendingBindStore().markUsed(nonce);
      return { ok: true };
    } catch (err) {
      console.error("[stripe.bind]", err instanceof Error ? err.message : "bind failed");
      return { ok: false, kind: "transient", reason: err instanceof Error ? err.message : "bind_failed" };
    }
  }
  const computer = live.find((row) => row.flockId === pending.flock);
  if (!computer) return permanent("mismatch");
  const store = getOauthStore();
  if (await store.computerHeldByOtherSubject(computer.id, pending.subject)) return permanent("held");
  try {
    const issued = await issueBoundCapability(computer.id, pending.flock, pending.clientId);
    const updated = await store.bindLiveTokens({
      clientId: pending.clientId,
      subject: pending.subject,
      computerId: issued.computerHandle,
      capabilityId: issued.capabilityId,
    });
    if (updated < 1) return permanent("no_live_token");
    await getPendingBindStore().markUsed(nonce);
    return { ok: true };
  } catch (err) {
    console.error("[stripe.bind]", err instanceof Error ? err.message : "bind failed");
    return { ok: false, kind: "transient", reason: err instanceof Error ? err.message : "bind_failed" };
  }
}

export async function recordPermanentBindFailure(nonce: string, reason: string): Promise<void> {
  await getPendingBindStore().markFailed(nonce, reason);
}

async function alreadyBoundToSeat(
  pending: { nonce: string; subject: string; flock: string; clientId: string },
  seat: SeatRecord,
  computers: Computer[],
): Promise<boolean> {
  if (pending.flock !== flockIdForEmail(seat.email)) return false;
  if (process.env.FLOK_PER_BOT_KEYS === "true") {
    const service = await getComputerService();
    const attached = service.computerIdForCheckoutNonce(pending.nonce);
    if (!attached) return false;
    return (
      computers.some((row) => row.id === attached) ||
      seat.computerIds.includes(attached) ||
      seat.computerId === attached
    );
  }
  const store = getOauthStore();
  for (const computer of computers) {
    if (computer.flockId !== pending.flock) continue;
    const binding = await store.liveComputerBinding(computer.id);
    if (binding && binding.subject === pending.subject && binding.clientId === pending.clientId) {
      return true;
    }
  }
  return false;
}

export async function bindFailedForEmail(email: string): Promise<boolean> {
  const store = getPendingBindStore();
  const rows = await store.listByEmail(email);
  const useUsedAt = !(await store.failureColumnsReady());
  const flagged = rows.some(
    (row) =>
      Boolean(row.failReason) || row.failedAt !== null || (useUsedAt && row.usedAt !== null),
  );
  if (!flagged) return false;
  const seats = await getSeatStore().listByEmail(email);
  if (seats.length === 0) return false;
  const ids = await computerIdsForEmail(email);
  const oauth = getOauthStore();
  for (const id of ids) {
    if (await oauth.liveComputerBinding(id)) return false;
  }
  if (process.env.FLOK_PER_BOT_KEYS === "true") {
    const service = await getComputerService();
    if (ids.some((id) => Boolean(service.liveBotKey(id)))) return false;
  }
  return true;
}

function uniqueComputerIds(seat: SeatRecord): string[] {
  const ids = [...seat.computerIds];
  if (seat.computerId && !ids.includes(seat.computerId)) ids.unshift(seat.computerId);
  return [...new Set(ids.filter(Boolean))];
}

async function computersForSeat(seat: SeatRecord): Promise<Computer[]> {
  const service = await getComputerService();
  const out: Computer[] = [];
  for (const id of uniqueComputerIds(seat)) {
    try {
      out.push(await service.get(id));
    } catch {
      // Computer may have been removed; skip.
    }
  }
  return out;
}

function syntheticCheckoutCompleted(seat: SeatRecord, pending: { nonce: string; subject: string; flock: string; clientId: string }): Stripe.Event {
  return {
    type: "checkout.session.completed",
    id: `complete:${pending.nonce}`,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: seat.stripeCheckoutSessionId ?? `cs_pending_${pending.nonce}`,
        customer: seat.stripeCustomerId,
        customer_email: seat.email,
        metadata: {
          bind_nonce: pending.nonce,
          subject: pending.subject,
          flock: pending.flock,
          oauth_client_id: pending.clientId,
        },
      },
    },
  } as unknown as Stripe.Event;
}

/** Finish provision + bot bind if the webhook returned before runtime completed. */
export async function completeOpenPurchase(input: {
  email?: string | null;
  flock?: string | null;
}): Promise<{ seats: number; bound: number }> {
  const store = getSeatStore();
  const seats = input.email
    ? await store.listByEmail(input.email)
    : input.flock
      ? (await store.listAll()).filter((seat) => flockIdForEmail(seat.email) === input.flock)
      : [];
  let bound = 0;
  for (const seat of seats) {
    if (seat.status !== "active") {
      try {
        await enforceBillingHold(seat);
      } catch (err) {
        console.error("[purchase.complete]", err instanceof Error ? err.message : err);
      }
      continue;
    }
    try {
      const provisioned = await provisionSeatComputers(seat);
      const fresh = (await store.getById(seat.id)) ?? seat;
      const computers = provisioned.length > 0 ? provisioned : await computersForSeat(fresh);
      const pending = await getPendingBindStore().listOpenByEmail(fresh.email);
      const matches = pending.filter((row) => !input.flock || row.flock === input.flock);
      for (const row of matches) {
        const outcome = await bindPurchasedComputer(syntheticCheckoutCompleted(fresh, row), fresh, computers);
        if (outcome.ok) bound += 1;
        else if (outcome.kind === "permanent") {
          await recordPermanentBindFailure(row.nonce, outcome.reason);
        }
      }
    } catch (err) {
      console.error("[purchase.complete]", err instanceof Error ? err.message : err);
    }
  }
  return { seats: seats.length, bound };
}
