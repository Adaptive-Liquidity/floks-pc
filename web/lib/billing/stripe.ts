import Stripe from "stripe";
import { checkoutReturnUrls } from "../app-url";
import {
  clampAgentQuantity,
  computersForPurchase,
  hoursForPurchase,
  isCheckoutPlanId,
  PLAN_CATALOG,
  recordedAgentQuantity,
  stripePriceIdForPlan,
  type CheckoutPlanId,
} from "./catalog";
import { applyMeteredSeconds } from "./metering";
import {
  emailsMatch,
  firstPriceIdFromUnknown,
  normalizeEmail,
  planFromAmount,
  planFromPriceId,
  planFromUnknown,
} from "./plans";
import { createSeat, getSeatStore, type SeatRecord, type SeatStatus } from "./seats";

export { planFromAmount, planFromPriceId };

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

export function priceIdFromCheckout(session: Stripe.Checkout.Session): string | null {
  const metaPrice = asString(session.metadata?.price_id ?? session.metadata?.priceId);
  if (metaPrice?.startsWith("price_")) return metaPrice;
  const items = session.line_items?.data ?? [];
  for (const item of items) {
    const id = firstPriceIdFromUnknown(item.price);
    if (id) return id;
  }
  return null;
}

export function quantityFromCheckout(session: Stripe.Checkout.Session, plan: CheckoutPlanId): number {
  const metaQty = Number(session.metadata?.agent_quantity ?? session.metadata?.quantity ?? "");
  const itemQty = session.line_items?.data[0]?.quantity ?? null;
  const raw = Number.isFinite(metaQty) && metaQty > 0 ? metaQty : itemQty ?? 1;
  return clampAgentQuantity(plan, raw);
}

export function planFromCheckout(
  session: Stripe.Checkout.Session,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutPlanId | null {
  const fromMeta = planFromUnknown(session.metadata?.plan ?? session.metadata?.Plan);
  if (fromMeta) return fromMeta;
  return planFromPriceId(priceIdFromCheckout(session), env);
}

export function planFromSubscription(
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutPlanId | null {
  const fromMeta = planFromUnknown(sub.metadata?.plan);
  if (fromMeta) return fromMeta;
  const priceId = firstPriceIdFromUnknown(sub.items.data[0]?.price);
  return planFromPriceId(priceId, env);
}

export async function applyCheckoutSession(session: Stripe.Checkout.Session): Promise<SeatRecord | null> {
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) return null;
  const expanded = await expandCheckoutIfNeeded(session);
  const plan = planFromCheckout(expanded);
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
  const quantity = quantityFromCheckout(expanded, plan);
  const seat = createSeat({
    email,
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeCheckoutSessionId: session.id,
    stripePriceId: priceIdFromCheckout(expanded),
    agentQuantity: quantity,
    maxComputers: computersForPurchase(plan, quantity),
    periodStart: session.created ? new Date(session.created * 1000).toISOString() : null,
  });
  return store.upsert(seat);
}

async function expandCheckoutIfNeeded(session: Stripe.Checkout.Session): Promise<Stripe.Checkout.Session> {
  if (session.line_items?.data?.length) return session;
  if (planFromUnknown(session.metadata?.plan)) return session;
  const client = getStripe();
  if (!client) return session;
  try {
    return await client.checkout.sessions.retrieve(session.id, { expand: ["line_items.data.price"] });
  } catch {
    return session;
  }
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
    const session = await client.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items.data.price"],
    });
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

function idFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const obj = asObject(value);
  return obj ? asString(obj.id) : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as Record<string, unknown>;
  const parent = asObject(raw.parent);
  const details = parent ? asObject(parent.subscription_details) : null;
  const lines = asObject(raw.lines);
  const lineRows = Array.isArray(lines?.data) ? lines.data : [];
  const fromLines = lineRows
    .map((row) => idFromUnknown(asObject(row)?.subscription))
    .find((id) => id);
  return (
    idFromUnknown(raw.subscription) ??
    asString(raw.subscription_id) ??
    idFromUnknown(details?.subscription) ??
    fromLines ??
    null
  );
}

function invoiceCustomerId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as Record<string, unknown>;
  return idFromUnknown(raw.customer);
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
  const plan = planFromSubscription(sub) ?? existing?.plan ?? null;
  const quantity = recordedAgentQuantity(Number(sub.items.data[0]?.quantity ?? existing?.agentQuantity ?? 1));
  if (!existing && (!emailRaw || !plan)) return null;
  const period = subscriptionPeriod(sub);
  const priceId = firstPriceIdFromUnknown(sub.items.data[0]?.price) ?? existing?.stripePriceId ?? null;
  if (existing) {
    const nextPlan = plan ?? existing.plan;
    const entry = PLAN_CATALOG[nextPlan];
    const maxComputers = nextPlan === "team" ? quantity : entry.computers;
    const hoursIncluded =
      nextPlan === "team" ? (entry.hoursPerAgent ?? entry.includedHours) * quantity : entry.includedHours;
    const periodChanged = Boolean(period.start && period.start !== existing.periodStart);
    let next: SeatRecord = {
      ...existing,
      status,
      plan: nextPlan,
      stripePriceId: priceId,
      agentQuantity: quantity,
      maxComputers,
      hoursIncluded,
      periodStart: period.start ?? existing.periodStart,
      periodEnd: period.end ?? existing.periodEnd,
    };
    if (periodChanged) {
      next = applyMeteredSeconds({ ...next, secondsUsed: 0, hoursUsed: 0 }, 0, new Date().toISOString());
    }
    return store.upsert(next);
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const created = createSeat({
    email: emailRaw ?? "",
    plan: plan ?? "personal",
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    status,
    agentQuantity: quantity,
    periodStart: period.start,
    periodEnd: period.end,
  });
  const entry = PLAN_CATALOG[created.plan];
  return store.upsert({
    ...created,
    agentQuantity: quantity,
    maxComputers: created.plan === "team" ? quantity : entry.computers,
    hoursIncluded:
      created.plan === "team" ? (entry.hoursPerAgent ?? entry.includedHours) * quantity : entry.includedHours,
  });
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
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const store = getSeatStore();
    const subId = invoiceSubscriptionId(invoice);
    const customerId = invoiceCustomerId(invoice);
    const existing =
      (subId ? await store.getBySubscription(subId) : null) ??
      (customerId
        ? (await store.listAll()).find((row) => row.stripeCustomerId === customerId) ?? null
        : null);
    if (!existing) return null;
    if (event.type === "invoice.payment_failed") {
      return store.upsert({ ...existing, status: "past_due" });
    }
    const line = invoice.lines?.data?.[0];
    const quantity = recordedAgentQuantity(Number(line?.quantity ?? existing.agentQuantity));
    const entry = PLAN_CATALOG[existing.plan];
    const maxComputers = existing.plan === "team" ? quantity : entry.computers;
    const hoursIncluded =
      existing.plan === "team" ? (entry.hoursPerAgent ?? entry.includedHours) * quantity : entry.includedHours;
    return store.upsert({
      ...existing,
      status: "active",
      agentQuantity: quantity,
      maxComputers,
      hoursIncluded,
    });
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

export class CheckoutNotConfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutNotConfigured";
  }
}

export async function createCheckoutSession(input: {
  request: Request;
  plan: string;
  email: string;
  quantity?: number;
}): Promise<{ url: string }> {
  if (!isCheckoutPlanId(input.plan)) {
    throw new CheckoutNotConfigured("That plan is not available for self-serve checkout.");
  }
  const priceId = stripePriceIdForPlan(input.plan);
  if (!priceId) {
    throw new CheckoutNotConfigured(
      `${stripePriceEnvNameSafe(input.plan)} is not set on this environment. Create a Stripe Price and set the env var (test Price ID on Preview, live Price ID on Production).`,
    );
  }
  const client = getStripe();
  if (!client) {
    throw new CheckoutNotConfigured("STRIPE_SECRET_KEY is required to start checkout.");
  }
  const quantity = clampAgentQuantity(input.plan, input.quantity ?? 1);
  const { successUrl, cancelUrl } = checkoutReturnUrls(input.request);
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: normalizeEmail(input.email),
    client_reference_id: normalizeEmail(input.email),
    line_items: [{ price: priceId, quantity }],
    metadata: {
      plan: input.plan,
      price_id: priceId,
      agent_quantity: String(quantity),
    },
    subscription_data: {
      metadata: {
        plan: input.plan,
        price_id: priceId,
        agent_quantity: String(quantity),
      },
    },
  });
  if (!session.url) {
    throw new CheckoutNotConfigured("Stripe did not return a checkout URL.");
  }
  return { url: session.url };
}

function stripePriceEnvNameSafe(plan: CheckoutPlanId): string {
  if (plan === "personal") return "STRIPE_PRICE_PERSONAL";
  if (plan === "pro") return "STRIPE_PRICE_PRO";
  return "STRIPE_PRICE_TEAM";
}
