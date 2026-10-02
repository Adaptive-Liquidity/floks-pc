import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../../../../../lib/auth/cookies";
import { userFromRequest } from "../../../../../../lib/auth/request-session";
import { createBuyLink } from "../../../../../../lib/billing/buy-link";
import { normalizePlanId } from "../../../../../../lib/billing/catalog";
import { flockIdForEmail, getComputerService } from "../../../../../../lib/desks/runtime";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../../../../lib/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "bot-claim-buy"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const origin = requestOrigin(request.url);
  if (!csrfOk(request, origin)) return NextResponse.json({ ok: false }, { status: 403 });
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { claimId } = await context.params;
  const form = await request.formData();
  const flock = flockIdForEmail(user.email);
  const service = await getComputerService();
  const claim = await service.getBotClaim(claimId);
  if (!claim || claim.flockId !== flock) return NextResponse.json({ ok: false }, { status: 404 });
  const botLabel = String(form.get("bot_name") ?? "").trim();
  if (botLabel.length < 1 || botLabel.length > 40) {
    return NextResponse.redirect(new URL(`/connect-bot/${claimId}?error=bot_name`, origin), { status: 303 });
  }
  if (claim.status !== "pending") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const plan = normalizePlanId(String(form.get("plan") ?? "personal")) ?? "personal";
  const link = await createBuyLink({
    origin,
    email: user.email,
    subject: user.id,
    flock,
    clientId: "connect-bot",
    plan,
  });
  await service.setClaimCheckoutNonce({ claimId, flockId: flock, nonce: link.nonce, botLabel });
  return NextResponse.redirect(link.url, { status: 303 });
}
