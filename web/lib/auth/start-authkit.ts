import { NextResponse } from "next/server";
import { getStripeCheckoutEmail } from "../billing/stripe";
import { requestOrigin } from "./cookies";
import { authStartFallbackPath, getAuthKitLoginUrl, type AuthKitScreenHint } from "./workos";

export async function redirectToAuthKit(
  request: Request,
  screenHint: AuthKitScreenHint,
): Promise<NextResponse> {
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
      screenHint,
    });
    return NextResponse.redirect(authUrl, { status: 302 });
  } catch {
    return NextResponse.redirect(new URL(authStartFallbackPath(), request.url), { status: 302 });
  }
}
