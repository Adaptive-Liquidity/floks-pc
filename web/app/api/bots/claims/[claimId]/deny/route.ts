import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../../../../../lib/auth/cookies";
import { userFromRequest } from "../../../../../../lib/auth/request-session";
import { flockIdForEmail, getComputerService } from "../../../../../../lib/desks/runtime";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../../../../lib/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "bot-claim-deny"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const origin = requestOrigin(request.url);
  if (!csrfOk(request, origin)) return NextResponse.json({ ok: false }, { status: 403 });
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { claimId } = await context.params;
  try {
    await (await getComputerService()).denyBotClaim({
      claimId,
      flockId: flockIdForEmail(user.email),
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.redirect(new URL("/setup", origin), { status: 303 });
}
