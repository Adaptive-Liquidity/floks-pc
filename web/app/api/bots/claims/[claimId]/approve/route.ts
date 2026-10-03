import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../../../../../lib/auth/cookies";
import { userFromRequest } from "../../../../../../lib/auth/request-session";
import { flockIdForEmail, getComputerService } from "../../../../../../lib/desks/runtime";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../../../../lib/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "bot-claim-approve"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const origin = requestOrigin(request.url);
  if (!csrfOk(request, origin)) return NextResponse.json({ ok: false }, { status: 403 });
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { claimId } = await context.params;
  const form = await request.formData();
  const botLabel = String(form.get("bot_name") ?? "");
  const computerId = String(form.get("computer_id") ?? "");
  try {
    await (await getComputerService()).approveBotClaim({
      claimId,
      flockId: flockIdForEmail(user.email),
      computerId,
      botLabel,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.redirect(new URL("/setup", origin), { status: 303 });
}
