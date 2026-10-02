import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { bindPurchasedComputer } from "./bind-purchase";
import { enforceBillingHold, provisionSeatComputers, resumeSeatComputers } from "./lifecycle";
import { claimStripeEvent, releaseStripeEvent } from "./stripe-events";
import {
  applyStripeEvent,
  constructStripeEvent,
  parseUnsignedStripeEvent,
  STRIPE_PAID_EVENT_TYPES,
} from "./stripe";
import { getSeatStore, type SeatRecord } from "./seats";

const PAID = new Set<string>(STRIPE_PAID_EVENT_TYPES);

export type WebhookDefer = (work: () => Promise<void>) => void;

export function deferNow(work: () => Promise<void>): void {
  void work();
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
    await bindPurchasedComputer(event, fresh, computers);
    return fresh;
  }
  if (seat.status === "past_due" || seat.status === "canceled") {
    return enforceBillingHold(seat);
  }
  return seat;
}

export async function handleVerifiedStripeEvent(event: Stripe.Event): Promise<{
  seat: SeatRecord | null;
  duplicate: boolean;
}> {
  if ((await claimStripeEvent(event.id, event.type)) === "duplicate") {
    return { seat: null, duplicate: true };
  }
  try {
    const seat = await applyStripeEvent(event);
    if (!seat) return { seat: null, duplicate: false };
    return { seat: await applySeatRuntime(event, seat), duplicate: false };
  } catch (err) {
    await releaseStripeEvent(event.id);
    throw err;
  }
}

export async function handleStripeWebhookRequest(
  request: Request,
  defer: WebhookDefer = deferNow,
): Promise<NextResponse> {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  let eventId: string | null = null;
  try {
    const event = signature
      ? constructStripeEvent(raw, signature)
      : parseUnsignedStripeEvent(JSON.parse(raw) as unknown);
    if (!event) {
      return NextResponse.json({ ok: false, message: "unsigned webhook refused" }, { status: 400 });
    }
    eventId = event.id;
    if ((await claimStripeEvent(event.id, event.type)) === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const seat = await applyStripeEvent(event);
    if (seat) {
      const captured = event;
      defer(async () => {
        try {
          await applySeatRuntime(captured, seat);
        } catch (err) {
          console.error("[stripe.webhook] runtime", err instanceof Error ? err.message : err);
          await releaseStripeEvent(captured.id);
        }
      });
    }
    return NextResponse.json({ ok: true, seatId: seat?.id ?? null });
  } catch {
    if (eventId) await releaseStripeEvent(eventId);
    return NextResponse.json({ ok: false, message: "webhook rejected" }, { status: 400 });
  }
}
