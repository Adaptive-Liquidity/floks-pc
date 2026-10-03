import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/request-session";
import { getSeatStore } from "@/lib/billing/seats";
import { provisionSeatComputers } from "@/lib/billing/lifecycle";
import { desksForSeats } from "@/lib/desks/runtime";
import { bindFailedForEmail } from "@/lib/billing/bind-purchase";
import { sessionFromSeats } from "@/lib/setup-payload";

export async function GET(request: Request) {
  const { user } = await userFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const seats = await getSeatStore().listByEmail(user.email);
  for (const seat of seats) {
    if (seat.status === "active" && !seat.computerId) {
      try {
        await provisionSeatComputers(seat);
      } catch (err) {
        console.error("[setup.retry]", err instanceof Error ? err.message : err);
      }
    }
  }
  const fresh = await getSeatStore().listByEmail(user.email);
  const desks = await desksForSeats(fresh);
  return NextResponse.json(
    sessionFromSeats({
      email: user.email,
      seats: fresh,
      desks,
      reconnectBot: await bindFailedForEmail(user.email),
    }),
  );
}
