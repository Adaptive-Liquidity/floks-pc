import { NextResponse, after } from "next/server";
import { applyStripeEvent, constructStripeEvent, parseUnsignedStripeEvent } from "@/lib/billing/stripe";
import { claimStripeEvent, releaseStripeEvent } from "@/lib/billing/stripe-events";
import { bindPurchasedComputer } from "@/lib/billing/bind-purchase";
import { provisionSeatComputers, shutdownSeatComputers } from "@/lib/billing/lifecycle";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
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
    if (seat?.status === "active" && event.type === "checkout.session.completed") {
      after(async () => {
        let computers: Awaited<ReturnType<typeof provisionSeatComputers>> = [];
        try {
          computers = await provisionSeatComputers(seat);
        } catch (err) {
          console.error("[stripe.webhook] provision", err instanceof Error ? err.message : err);
        }
        try {
          await bindPurchasedComputer(event, seat, computers);
        } catch (err) {
          console.error("[stripe.webhook] bind", err instanceof Error ? err.message : err);
        }
      });
    }
    if (seat && (seat.status === "canceled" || seat.status === "past_due")) {
      try {
        await shutdownSeatComputers(seat, seat.status === "canceled" ? "destroy" : "stop");
      } catch (err) {
        console.error("[stripe.webhook] shutdown", err instanceof Error ? err.message : err);
      }
    }
    return NextResponse.json({ ok: true, seatId: seat?.id ?? null });
  } catch {
    if (eventId) await releaseStripeEvent(eventId);
    return NextResponse.json({ ok: false, message: "webhook rejected" }, { status: 400 });
  }
}
