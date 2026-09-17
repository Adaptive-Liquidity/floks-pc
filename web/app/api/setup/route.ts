import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/request-session";
import { getSeatStore } from "@/lib/billing/seats";
import { desksForSeats } from "@/lib/desks/runtime";
import { sessionFromSeats } from "@/lib/setup-payload";

export async function GET(request: Request) {
  const { user } = await userFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const seats = await getSeatStore().listByEmail(user.email);
  const desks = await desksForSeats(seats);
  return NextResponse.json(sessionFromSeats({ email: user.email, seats, desks }));
}
