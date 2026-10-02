import { NextResponse } from "next/server";
import { authKitScreenHint } from "@/lib/auth/workos";
import { redirectToAuthKit } from "@/lib/auth/start-authkit";
import { clientKey, rateLimitedBody, takeRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  if (!takeRateLimit(clientKey(request, "login"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const screen = new URL(request.url).searchParams.get("screen");
  return redirectToAuthKit(request, authKitScreenHint(screen));
}
