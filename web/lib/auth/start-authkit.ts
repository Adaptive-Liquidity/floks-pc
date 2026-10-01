import { NextResponse } from "next/server";
import { getStripeCheckoutEmail } from "../billing/stripe";
import { publicOriginFromRequest } from "./callback";
import { authStartFallbackPath, getAuthKitLoginUrl, type AuthKitScreenHint } from "./workos";

function authReturnState(url: URL, sessionId: string | null): string {
  const ret = url.searchParams.get("return");
  if (ret && ret.startsWith("/oauth/authorize") && !ret.includes("://") && !ret.includes("\\")) {
    return `return:${ret}`;
  }
  return sessionId ? `checkout:${sessionId}` : "setup";
}

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
      state: authReturnState(url, sessionId),
      screenHint,
    });
    return NextResponse.redirect(authUrl, { status: 302 });
  } catch (err) {
    console.error("[authkit] start", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL(authStartFallbackPath(), request.url), { status: 302 });
  }
}
