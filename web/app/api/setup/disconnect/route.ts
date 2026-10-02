import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../../../lib/auth/cookies";
import { userFromRequest } from "../../../../lib/auth/request-session";
import { getSeatStore } from "../../../../lib/billing/seats";
import { getComputerService } from "../../../../lib/desks/runtime";
import { getOauthStore } from "../../../../lib/oauth";

export async function POST(request: Request) {
  if (!csrfOk(request, requestOrigin(request.url))) {
    return NextResponse.json({ ok: false, message: "Origin mismatch" }, { status: 403 });
  }
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });
  const form = await request.formData();
  const computerId = String(form.get("computer_id") ?? "").trim();
  const seats = await getSeatStore().listByEmail(user.email);
  const owned = seats.some(
    (seat) => seat.computerId === computerId || seat.computerIds.includes(computerId),
  );
  if (!computerId || !owned) {
    return NextResponse.json({ ok: false, message: "That computer is not on this account." }, { status: 403 });
  }
  try {
    await (await getComputerService()).revokeBoundComputer(computerId);
  } catch (err) {
    console.error("[setup.disconnect]", err instanceof Error ? err.message : err);
  }
  await getOauthStore().revokeComputerTokens(computerId);
  return NextResponse.json({ ok: true });
}
