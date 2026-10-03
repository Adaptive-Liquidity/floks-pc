import type Stripe from "stripe";
import { cookies } from "next/headers";
import { COOKIE_NAME, loadAuthSession } from "./auth/workos";
import { getSeatStore } from "./billing/seats";
import { bindPurchasedComputer, completeOpenPurchase } from "./billing/bind-purchase";
import { enforceBillingHold, provisionSeatComputers } from "./billing/lifecycle";
import { ensureSeatFromCheckout, getStripe, getStripeCheckoutEmail } from "./billing/stripe";
import { desksForSeats, getComputerService } from "./desks/runtime";
import { getOauthStore } from "./oauth";
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

async function finishPaidCheckoutForSetup(sessionId: string, email: string) {
  const seat = await ensureSeatFromCheckout(sessionId, email);
  if (!seat || seat.status !== "active") return seat;
  const computers = await provisionSeatComputers(seat);
  const client = getStripe();
  if (!client) return seat;
  try {
    const session = await client.checkout.sessions.retrieve(sessionId);
    await bindPurchasedComputer(
      {
        type: "checkout.session.completed",
        id: `setup:${sessionId}`,
        data: { object: session },
        created: session.created ?? 0,
      } as unknown as Stripe.Event,
      seat,
      computers,
    );
  } catch (err) {
    console.error("[setup.bind]", err instanceof Error ? err.message : err);
  }
  return seat;
}

export async function liveSeatSession(email: string, webhookPending = false): Promise<SeatSession> {
  const store = getSeatStore();
  try {
    await completeOpenPurchase({ email });
  } catch (err) {
    console.error("[setup.complete]", err instanceof Error ? err.message : err);
  }
  let seats = await store.listByEmail(email);
  for (const seat of seats) {
    try {
      if (seat.status === "active") await provisionSeatComputers(seat);
      else await enforceBillingHold(seat);
    } catch (err) {
      console.error("[setup.provision]", seat.id, err instanceof Error ? err.message : err);
    }
  }
  seats = await store.listByEmail(email);
  const desks = await desksForSeats(seats);
  const perBot = process.env.FLOK_PER_BOT_KEYS === "true";
  const service = perBot ? await getComputerService() : null;
  for (const desk of desks) {
    if (!desk.computerId) continue;
    if (service) {
      const key = service.liveBotKey(desk.computerId);
      if (!key) continue;
      desk.botName = key.botLabel;
      desk.lastUsedLabel = key.lastUsedAt ? key.lastUsedAt.toISOString() : "never";
      continue;
    }
    const binding = await getOauthStore().liveComputerBinding(desk.computerId);
    if (!binding) continue;
    const client = await getOauthStore().getClient(binding.clientId);
    desk.botName = client?.clientName || "another Bot";
  }
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
      const applied = await finishPaidCheckoutForSetup(search.session_id, auth.email);
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
