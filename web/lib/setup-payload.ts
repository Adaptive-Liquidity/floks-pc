import { periodLabel, type SeatRecord } from "./billing/seats";
import type { DeskRecord, PlanId, SeatSession } from "./types";

export function sessionFromSeats(input: {
  email: string;
  seats: SeatRecord[];
  desks: DeskRecord[];
  webhookPending?: boolean;
  revealedPairCode?: string | null;
}): SeatSession {
  const live = input.seats.filter((seat) => seat.status !== "canceled");
  const primary = live[0] ?? input.seats[0] ?? null;
  const desk = input.desks[0] ?? null;
  const plan: PlanId | null = primary?.plan ?? null;
  const hoursUsed = live.reduce((sum, seat) => sum + seat.hoursUsed, 0);
  const hoursIncluded = live.reduce((sum, seat) => sum + seat.hoursIncluded, 0);
  return {
    authenticated: true,
    billingEmail: input.email,
    plan,
    periodLabel: primary ? periodLabel(primary) : null,
    flockStatus: live.some((seat) => seat.status === "past_due") ? "past_due" : "ok",
    seats: live.length,
    pluginAllowed: true,
    webhookPending: Boolean(input.webhookPending),
    desk,
    desks: input.desks,
    hoursUsed: live.length ? hoursUsed : null,
    hoursIncluded: live.length ? hoursIncluded : null,
    portalReady: Boolean(primary?.stripeCustomerId),
    revealedPairCode: input.revealedPairCode ?? null,
  };
}
