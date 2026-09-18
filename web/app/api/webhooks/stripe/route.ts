import { NextResponse } from "next/server";
import { applyStripeEvent, constructStripeEvent, parseUnsignedStripeEvent } from "@/lib/billing/stripe";

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
    return NextResponse.json({ ok: true, seatId: seat?.id ?? null });
  } catch {
    return NextResponse.json({ ok: false, message: "webhook rejected" }, { status: 400 });
  }
}
