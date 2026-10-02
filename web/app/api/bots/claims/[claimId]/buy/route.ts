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
  const plan = normalizePlanId(String(form.get("plan") ?? "personal")) ?? "personal";
  const flock = flockIdForEmail(user.email);
  const link = await createBuyLink({
    origin,
    email: user.email,
    subject: user.id,
    flock,
    clientId: "connect-bot",
    plan,
  });
  await (await getComputerService()).setClaimCheckoutNonce({ claimId, flockId: flock, nonce: link.nonce });
  return NextResponse.redirect(link.url, { status: 303 });
}
