import { NextResponse } from "next/server";
import { applyStripeEvent, constructStripeEvent, parseUnsignedStripeEvent } from "@/lib/billing/stripe";
import { provisionSeatComputers, shutdownSeatComputers } from "@/lib/billing/lifecycle";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  try {
    const event = signature
      ? constructStripeEvent(raw, signature)
      : parseUnsignedStripeEvent(JSON.parse(raw) as unknown);
    if (!event) {
      return NextResponse.json({ ok: false, message: "unsigned webhook refused" }, { status: 400 });
    }
    const seat = await applyStripeEvent(event);
    if (seat?.status === "active" && event.type === "checkout.session.completed") {
      try {
        await provisionSeatComputers(seat);
      } catch (err) {
        console.error("[stripe.webhook] provision", err instanceof Error ? err.message : err);
      }
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
    return NextResponse.json({ ok: false, message: "webhook rejected" }, { status: 400 });
  }
}
