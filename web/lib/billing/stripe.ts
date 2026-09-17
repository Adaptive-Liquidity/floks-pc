import Stripe from "stripe";
import { createSeat, getSeatStore, type SeatRecord, type SeatStatus } from "./seats";
import { emailsMatch, hoursForPlan, normalizeEmail, planFromAmount, planFromUnknown } from "./plans";
import type { PlanId } from "../types";

let stripe: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (stripe !== undefined) return stripe;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  stripe = key ? new Stripe(key) : null;
  return stripe;
}

export function resetStripeForTests(): void {
  stripe = undefined;
}

export async function getStripeCheckoutEmail(sessionId: string): Promise<string | null> {
  const client = getStripe();
  if (!client) return null;
  try {
    const session = await client.checkout.sessions.retrieve(sessionId);
    const email = session.customer_details?.email ?? session.customer_email;
    return email ? normalizeEmail(email) : null;
  } catch {
    return null;
  }
}

export async function findStripeCustomerIdByEmail(email: string): Promise<string | null> {
  const client = getStripe();
  if (!client) return null;
  try {
    const customers = await client.customers.list({ email: normalizeEmail(email), limit: 5 });
    const match = customers.data.find((row) => row.email && normalizeEmail(row.email) === normalizeEmail(email));
    return match?.id ?? customers.data[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function createCustomerPortalUrl(customerId: string, returnUrl: string): Promise<string | null> {
  const client = getStripe();
  if (!client) return null;
  const session = await client.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function planFromCheckout(session: Stripe.Checkout.Session): PlanId | null {
  const meta = session.metadata?.plan ?? session.metadata?.Plan;
  const fromMeta = planFromUnknown(meta);
  if (fromMeta) return fromMeta;
  return planFromAmount(session.amount_total);
}

export async function applyCheckoutSession(session: Stripe.Checkout.Session): Promise<SeatRecord | null> {
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) return null;
  const plan = planFromCheckout(session);
  if (!plan) return null;
  const store = getSeatStore();
  const existing = await store.getByCheckoutSession(session.id);
  if (existing) return existing;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer && typeof session.customer === "object"
        ? session.customer.id
        : "";
  if (!customerId) return null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription && typeof session.subscription === "object"
        ? session.subscription.id
        : null;
  const seat = createSeat({
    email,
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeCheckoutSessionId: session.id,
    periodStart: session.created ? new Date(session.created * 1000).toISOString() : null,
  });
  return store.upsert(seat);
}

/** Verified checkout, not a guessed seat. Emails must match the signed-in user. */
export async function ensureSeatFromCheckout(
  sessionId: string,
  email: string,
): Promise<SeatRecord | null> {
  const store = getSeatStore();
  const existing = await store.getByCheckoutSession(sessionId);
  if (existing) {
    return emailsMatch(existing.email, email) ? existing : null;
  }
  const client = getStripe();
  if (!client) return null;
  try {
    const session = await client.checkout.sessions.retrieve(sessionId);
    const checkoutEmail = session.customer_details?.email ?? session.customer_email;
    if (!checkoutEmail || !emailsMatch(checkoutEmail, email)) return null;
    return applyCheckoutSession(session);
  } catch {
    return null;
  }
}

function unixToIso(value: unknown): string | null {
  const seconds = asNumber(value);
  if (seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

function subscriptionPeriod(sub: Stripe.Subscription): { start: string | null; end: string | null } {
  const raw = sub as unknown as Record<string, unknown>;
  const item = asObject(sub.items.data[0] as unknown);
  return {
    start: unixToIso(raw.current_period_start) ?? unixToIso(item?.current_period_start),
    end: unixToIso(raw.current_period_end) ?? unixToIso(item?.current_period_end),
  };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as Record<string, unknown>;
  const direct = raw.subscription;
  if (typeof direct === "string") return direct;
  const nested = asObject(direct);
  if (nested && typeof nested.id === "string") return nested.id;
  const parent = asObject(raw.parent);
  const details = parent ? asObject(parent.subscription_details) : null;
  return asString(details?.subscription);
}

export async function applySubscription(sub: Stripe.Subscription): Promise<SeatRecord | null> {
  const store = getSeatStore();
  const existing = await store.getBySubscription(sub.id);
  const emailRaw =
    typeof sub.customer === "object" && sub.customer && "email" in sub.customer
      ? asString((sub.customer as { email?: unknown }).email)
      : null;
  const status: SeatStatus =
    sub.status === "past_due" || sub.status === "unpaid"
      ? "past_due"
      : sub.status === "canceled"
        ? "canceled"
        : "active";
  const plan =
    planFromUnknown(sub.metadata?.plan) ??
    existing?.plan ??
    planFromAmount(sub.items.data[0]?.price.unit_amount ?? null);
  if (!existing && (!emailRaw || !plan)) return null;
  const period = subscriptionPeriod(sub);
  if (existing) {
    const next: SeatRecord = {
      ...existing,
      status,
      plan: plan ?? existing.plan,
      hoursIncluded: hoursForPlan(plan ?? existing.plan),
      periodStart: period.start ?? existing.periodStart,
      periodEnd: period.end ?? existing.periodEnd,
    };
    return store.upsert(next);
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return store.upsert(
    createSeat({
      email: emailRaw ?? "",
      plan: plan ?? "desk",
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      status,
      periodStart: period.start,
      periodEnd: period.end,
    }),
  );
}

export async function applyStripeEvent(event: Stripe.Event): Promise<SeatRecord | null> {
  if (event.type === "checkout.session.completed") {
    return applyCheckoutSession(event.data.object as Stripe.Checkout.Session);
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.deleted"
  ) {
    return applySubscription(event.data.object as Stripe.Subscription);
  }
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return null;
    const store = getSeatStore();
    const existing = await store.getBySubscription(subId);
    if (!existing) return null;
    return store.upsert({ ...existing, status: "past_due" });
  }
  return null;
}

export function constructStripeEvent(rawBody: string, signature: string | null): Stripe.Event {
  const client = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!client) throw new Error("STRIPE_SECRET_KEY is required");
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is required");
  if (!signature) throw new Error("Stripe-Signature is required");
  return client.webhooks.constructEvent(rawBody, signature, secret);
}

export function parseUnsignedStripeEvent(raw: unknown): Stripe.Event | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.FLOK_WEB_STRIPE_UNSIGNED !== "1") return null;
  const obj = asObject(raw);
  if (!obj || asString(obj.type) === null) return null;
  return raw as Stripe.Event;
}

export function asStripeNumber(value: unknown): number | null {
  return asNumber(value);
}
