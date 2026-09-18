import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "@/lib/auth/cookies";
import { userFromRequest } from "@/lib/auth/request-session";
import { getSeatStore } from "@/lib/billing/seats";
import { createCustomerPortalUrl, findStripeCustomerIdByEmail } from "@/lib/billing/stripe";

export async function POST(request: Request) {
  const origin = requestOrigin(request.url);
  if (!csrfOk(request, origin)) {
    return NextResponse.json({ ok: false, message: "Origin mismatch" }, { status: 403 });
  }
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  const seats = await getSeatStore().listByEmail(user.email);
  const customerId = seats[0]?.stripeCustomerId ?? (await findStripeCustomerIdByEmail(user.email));
  if (!customerId) {
    return NextResponse.redirect(new URL("/setup", request.url), { status: 302 });
  }
  const portal = await createCustomerPortalUrl(customerId, `${origin}/setup`);
  if (!portal) {
    return NextResponse.redirect(new URL("/setup?error=invalid", request.url), { status: 302 });
  }
  return NextResponse.redirect(portal, { status: 302 });
}
