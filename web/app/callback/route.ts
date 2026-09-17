import { NextResponse } from "next/server";
import { applySessionCookie } from "@/lib/auth/cookies";
import { authenticateAuthKitCode } from "@/lib/auth/workos";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const sessionId = url.searchParams.get("session_id");
  const error = url.searchParams.get("error");

  if (!code) {
    if (sessionId) {
      return NextResponse.redirect(new URL(`/setup?session_id=${encodeURIComponent(sessionId)}`, request.url), {
        status: 302,
      });
    }
    const kind = error === "access_denied" || error === "expired_token" ? "expired" : "invalid";
    return NextResponse.redirect(new URL(`/setup?error=${kind}`, request.url), { status: 302 });
  }

  try {
    const auth = await authenticateAuthKitCode(code);
    const state = url.searchParams.get("state") ?? "";
    const checkout = state.startsWith("checkout:") ? state.slice("checkout:".length) : "";
    const dest = checkout
      ? `/setup?session_id=${encodeURIComponent(checkout)}`
      : "/setup";
    const response = NextResponse.redirect(new URL(dest, request.url), { status: 302 });
    return applySessionCookie(response, auth.sealedSession, request.url);
  } catch {
    return NextResponse.redirect(new URL("/setup?error=invalid", request.url), { status: 302 });
  }
}
