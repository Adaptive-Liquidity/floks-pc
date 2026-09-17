import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "@/lib/auth/cookies";
import { userFromRequest } from "@/lib/auth/request-session";
import { getSeatStore } from "@/lib/billing/seats";
import { revokePairKey } from "@/lib/desks/runtime";
import { emailsMatch } from "@/lib/billing/plans";

export async function POST(request: Request) {
  if (!csrfOk(request, requestOrigin(request.url))) {
    return NextResponse.json({ ok: false, message: "Origin mismatch" }, { status: 403 });
  }
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });
  const form = await request.formData();
  const seatId = String(form.get("seat_id") ?? "").trim();
  const seats = await getSeatStore().listByEmail(user.email);
  const seat = seatId ? seats.find((row) => row.id === seatId) : seats[0];
  if (!seat || !emailsMatch(seat.email, user.email)) {
    return NextResponse.json({ ok: false, message: "No seat yet. Pay for a plan." }, { status: 403 });
  }
  const burned = await revokePairKey(seat);
  return NextResponse.json({ ok: true, burned });
}
