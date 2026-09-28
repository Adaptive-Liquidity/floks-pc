import { NextResponse } from "next/server";
import { getStripeCheckoutEmail } from "../billing/stripe";
import { publicOriginFromRequest } from "./callback";
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
      origin: publicOriginFromRequest(request),
      email,
      state: sessionId ? `checkout:${sessionId}` : "setup",
      screenHint,
    });
    return NextResponse.redirect(authUrl, { status: 302 });
  } catch (err) {
    console.error("[authkit] start", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL(authStartFallbackPath(), request.url), { status: 302 });
  }
}
