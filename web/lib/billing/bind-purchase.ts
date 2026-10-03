import type Stripe from "stripe";
import type { Computer } from "../../../src/lib/computers/index";
import { flockIdForEmail, getComputerService } from "../desks/runtime";
import { getOauthStore } from "../oauth";
import { enforceBillingHold, provisionSeatComputers } from "./lifecycle";
import { getPendingBindStore } from "./pending-binds";
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

/**
 * After the seat's computer exists, attach it to the Bot that started checkout.
 * A bad nonce, subject, or flock leaves the computer in place for /setup.
 */
export async function bindPurchasedComputer(
  event: Stripe.Event,
  seat: SeatRecord,
  computers: Computer[],
): Promise<boolean> {
  if (event.type !== "checkout.session.completed") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata ?? {};
  const nonce = meta.bind_nonce?.trim() ?? "";
  if (!nonce) return false;
  const subject = meta.subject?.trim() ?? "";
  const flock = meta.flock?.trim() ?? "";
  const clientId = meta.oauth_client_id?.trim() ?? "";
  const pending = await getPendingBindStore().get(nonce);
  if (!pending || pending.usedAt !== null) return false;
  if (pending.openedAt !== null && pending.openedAt > pending.expiresAt) return false;
  if (pending.openedAt === null && pending.expiresAt <= Date.now()) return false;
  if (pending.subject !== subject || pending.flock !== flock || pending.clientId !== clientId) return false;
  if (pending.flock !== flockIdForEmail(seat.email)) return false;
  const service = await getComputerService();
  if (process.env.FLOK_PER_BOT_KEYS === "true") {
    const open = computers.find((row) => row.flockId === pending.flock && !service.liveBotKey(row.id));
    if (!open) return false;
    const attached = await service.attachPurchaseToClaim(nonce, open.id);
    if (!attached) return false;
    await getPendingBindStore().markUsed(nonce);
    return true;
  }
  const computer = computers.find((row) => row.flockId === pending.flock);
  if (!computer) return false;
  const store = getOauthStore();
  if (await store.computerHeldByOtherSubject(computer.id, pending.subject)) return false;
  try {
    const issued = await issueBoundCapability(computer.id, pending.flock, pending.clientId);
    const updated = await store.bindLiveTokens({
      clientId: pending.clientId,
      subject: pending.subject,
      computerId: issued.computerHandle,
      capabilityId: issued.capabilityId,
    });
    if (updated < 1) return false;
    await getPendingBindStore().markUsed(nonce);
    return true;
  } catch (err) {
    console.error("[stripe.bind]", err instanceof Error ? err.message : "bind failed");
    return false;
  }
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
  } as Stripe.Event;
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
        if (await bindPurchasedComputer(syntheticCheckoutCompleted(fresh, row), fresh, computers)) {
          bound += 1;
        }
      }
    } catch (err) {
      console.error("[purchase.complete]", err instanceof Error ? err.message : err);
    }
  }
  return { seats: seats.length, bound };
}
