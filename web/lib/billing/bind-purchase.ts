import type Stripe from "stripe";
import type { Computer } from "../../../src/lib/computers/index";
import { flockIdForEmail, getComputerService } from "../desks/runtime";
import { getOauthStore } from "../oauth";
import { getPendingBindStore } from "./pending-binds";
import type { SeatRecord } from "./seats";

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
  if (!pending || pending.usedAt !== null || pending.expiresAt <= Date.now()) return false;
  if (pending.subject !== subject || pending.flock !== flock || pending.clientId !== clientId) return false;
  if (pending.flock !== flockIdForEmail(seat.email)) return false;
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
