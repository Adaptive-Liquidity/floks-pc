import { NextResponse } from "next/server";
import { CheckoutNotConfigured, createCheckoutSession } from "../../lib/billing/stripe";
import { openBuyToken } from "../../lib/billing/buy-link";

export const runtime = "nodejs";

/** Signed checkout link. The token carries the signed-in account, so this page does not ask for Staxions again. */
export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const opened = await openBuyToken(token);
  if (!opened.ok) {
    return NextResponse.json({ error: opened.reason }, { status: 400 });
  }
  try {
    const session = await createCheckoutSession({
      request,
      plan: opened.payload.plan,
      email: opened.payload.email,
      bindMetadata: {
        oauth_client_id: opened.payload.clientId,
        subject: opened.payload.subject,
        flock: opened.payload.flock,
        bind_nonce: opened.payload.nonce,
      },
    });
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    const message = err instanceof CheckoutNotConfigured ? err.message : "Checkout could not start.";
    return NextResponse.json({ error: "checkout_unavailable", message }, { status: 503 });
  }
}
