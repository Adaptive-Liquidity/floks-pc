import { NextResponse } from "next/server";
import { redirectToAuthKit } from "@/lib/auth/start-authkit";
import { clientKey, rateLimitedBody, takeRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  if (!takeRateLimit(clientKey(request, "signup"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  return redirectToAuthKit(request, "sign-up");
}
