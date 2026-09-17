import { NextResponse } from "next/server";
import { AuthNotConfigured, getAuthKitLoginUrl } from "@/lib/auth/workos";
import { getStripeCheckoutEmail } from "@/lib/billing/stripe";
import { requestOrigin } from "@/lib/auth/cookies";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const emailParam = url.searchParams.get("email");
  const sessionId = url.searchParams.get("session_id");
  let email = emailParam?.trim() || null;
  if (!email && sessionId) {
    email = await getStripeCheckoutEmail(sessionId);
  }
  try {
    const authUrl = getAuthKitLoginUrl({
      origin: requestOrigin(request.url),
      email,
      state: sessionId ? `checkout:${sessionId}` : null,
    });
    return NextResponse.redirect(authUrl, { status: 302 });
  } catch (err) {
    const dest = err instanceof AuthNotConfigured ? "/setup?error=invalid" : "/setup?error=invalid";
    return NextResponse.redirect(new URL(dest, request.url), { status: 302 });
  }
}
