import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { bindPurchasedComputer, recordPermanentBindFailure } from "./bind-purchase";
import { enforceBillingHold, provisionSeatComputers, resumeSeatComputers } from "./lifecycle";
import {
  claimStripeEvent,
  completeStripeEvent,
  releaseStripeEvent,
} from "./stripe-events";
import {
  applyStripeEvent,
  constructStripeEvent,
  parseUnsignedStripeEvent,
  STRIPE_PAID_EVENT_TYPES,
} from "./stripe";
import { DurableStoreRequired, getSeatStore, type SeatRecord } from "./seats";

const PAID = new Set<string>(STRIPE_PAID_EVENT_TYPES);

function checkoutBindNonce(event: Stripe.Event): string {
  if (event.type !== "checkout.session.completed") return "";
  const session = event.data.object as Stripe.Checkout.Session;
  return session.metadata?.bind_nonce?.trim() ?? "";
}

export async function applySeatRuntime(event: Stripe.Event, seat: SeatRecord): Promise<SeatRecord> {
  if (seat.status === "active" && PAID.has(event.type)) {
    const computers = await provisionSeatComputers(seat);
    const fresh =
      (await getSeatStore().getById(seat.id)) ??
      {
        ...seat,
        computerId: computers[0]?.id ?? seat.computerId,
        computerIds: computers.length > 0 ? computers.map((row) => row.id) : seat.computerIds,
      };
    await resumeSeatComputers(fresh);
    const outcome = await bindPurchasedComputer(event, fresh, computers);
    if (outcome.ok || outcome.kind === "none") return fresh;
    const nonce = checkoutBindNonce(event);
    if (outcome.kind === "permanent") {
      if (nonce) await recordPermanentBindFailure(nonce, outcome.reason);
      return fresh;
    }
    throw new Error(outcome.reason);
  }
  if (seat.status === "past_due" || seat.status === "canceled") {
    return enforceBillingHold(seat);
  }
  return seat;
}

export async function handleVerifiedStripeEvent(event: Stripe.Event): Promise<{
  seat: SeatRecord | null;
  duplicate: boolean;
  inFlight?: boolean;
}> {
  const lease = await claimStripeEvent(event.id, event.type);
  if (lease.claim === "in_flight") {
    return { seat: null, duplicate: true, inFlight: true };
  }
  if (lease.claim === "duplicate") {
    return { seat: null, duplicate: true };
  }
  try {
    const seat = await applyStripeEvent(event);
    if (!seat) {
      await completeStripeEvent(event.id, lease.claimedAt);
      return { seat: null, duplicate: false };
    }
    const next = await applySeatRuntime(event, seat);
    await completeStripeEvent(event.id, lease.claimedAt);
    return { seat: next, duplicate: false };
  } catch (err) {
    await releaseStripeEvent(event.id, lease.claimedAt);
    throw err;
  }
}

export async function handleStripeWebhookRequest(request: Request): Promise<NextResponse> {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  let eventId: string | null = null;
  let claimedAt: number | null = null;
  try {
    const event = signature
      ? constructStripeEvent(raw, signature)
      : parseUnsignedStripeEvent(JSON.parse(raw) as unknown);
    if (!event) {
      return NextResponse.json({ ok: false, message: "unsigned webhook refused" }, { status: 400 });
    }
    eventId = event.id;
    const lease = await claimStripeEvent(event.id, event.type);
    if (lease.claim === "in_flight") {
      return NextResponse.json({ ok: false, duplicate: true, in_flight: true }, { status: 409 });
    }
    if (lease.claim === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    claimedAt = lease.claimedAt;
    const seat = await applyStripeEvent(event);
    if (seat) await applySeatRuntime(event, seat);
    await completeStripeEvent(event.id, lease.claimedAt);
    return NextResponse.json({ ok: true, seatId: seat?.id ?? null });
  } catch (err) {
    if (eventId && !(err instanceof DurableStoreRequired)) {
      if (claimedAt !== null) {
        try {
          await releaseStripeEvent(eventId, claimedAt);
        } catch {
          // Best-effort: Stripe retries on 500 even if the lease row cannot be marked failed.
        }
      }
      console.error("[stripe.webhook]", err instanceof Error ? err.message : err);
    }
    const status = err instanceof DurableStoreRequired ? 400 : eventId ? 500 : 400;
    return NextResponse.json({ ok: false, message: "webhook rejected" }, { status });
  }
}
