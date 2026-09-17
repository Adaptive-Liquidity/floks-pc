import { cookies } from "next/headers";
import { COOKIE_NAME, loadAuthSession } from "./auth/workos";
import { getSeatStore } from "./billing/seats";
import { ensureSeatFromCheckout, getStripeCheckoutEmail } from "./billing/stripe";
import { desksForSeats } from "./desks/runtime";
import { sessionFromSeats } from "./setup-payload";
import { gateFromSearch, previewSession } from "./session";
import { previewEnabled } from "./preview";
import type { SeatSession, SetupView } from "./types";

export async function readAuthFromCookies(): Promise<{
  email: string | null;
  sealedSession: string | null;
  refreshedSealed: string | null;
}> {
  const jar = await cookies();
  const sealed = jar.get(COOKIE_NAME)?.value ?? null;
  const loaded = await loadAuthSession(sealed);
  if (!loaded.ok) return { email: null, sealedSession: sealed, refreshedSealed: null };
  return {
    email: loaded.user.email,
    sealedSession: loaded.sealedSession,
    refreshedSealed: loaded.sealedSession !== sealed ? loaded.sealedSession : null,
  };
}

export async function liveSeatSession(email: string, webhookPending = false): Promise<SeatSession> {
  const seats = await getSeatStore().listByEmail(email);
  const desks = await desksForSeats(seats);
  return sessionFromSeats({ email, seats, desks, webhookPending });
}

export async function resolveSetupView(search: {
  session_id?: string;
  error?: string;
  link?: string;
  preview?: string;
}): Promise<SetupView> {
  if (search.preview && previewEnabled()) {
    const session = previewSession(search.preview);
    if (session) return { kind: "desk", session, preview: true };
  }

  const auth = await readAuthFromCookies();
  if (auth.email) {
    let webhookPending = false;
    if (search.session_id) {
      const applied = await ensureSeatFromCheckout(search.session_id, auth.email);
      const seats = await getSeatStore().listByEmail(auth.email);
      const already = Boolean(applied) || seats.some((seat) => seat.stripeCheckoutSessionId === search.session_id);
      webhookPending = !already;
    }
    return { kind: "desk", session: await liveSeatSession(auth.email, webhookPending), preview: false };
  }

  if (search.session_id) {
    const email = await getStripeCheckoutEmail(search.session_id);
    if (email) {
      const seats = await getSeatStore().listByEmail(email);
      if (seats.length === 0) {
        const { gate, sessionId } = gateFromSearch(search);
        return { kind: "gate", gate, sessionId };
      }
    }
  }

  const { gate, sessionId } = gateFromSearch(search);
  return { kind: "gate", gate, sessionId };
}
