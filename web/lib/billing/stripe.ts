import Stripe from "stripe";
import { checkoutReturnUrls } from "../app-url";
import {
  clampAgentQuantity,
  computersForPurchase,
  isCheckoutPlanId,
  PLAN_CATALOG,
  recordedAgentQuantity,
  stripePriceIdForPlan,
  type CheckoutPlanId,
} from "./catalog";
import { applyMeteredSeconds } from "./metering";
import { resolvePortalConfigurationId } from "./portal";
import {
  emailsMatch,
  firstPriceIdFromUnknown,
  normalizeEmail,
  planFromAmount,
  planFromPriceId,
  planFromUnknown,
} from "./plans";
import {
  clearGrace,
  eventCreatedMs,
  isStaleBillingEvent,
  startGrace,
  withBillingEventAt,
} from "./grace";
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

export function setStripeForTests(client: Stripe | null): void {
  stripe = client;
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
  const configuration = await resolvePortalConfigurationId(client);
  const session = await client.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    ...(configuration ? { configuration } : {}),
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
  const priceId = priceIdFromCheckout(session);
  const fromPrice = planFromPriceId(priceId, env);
  if (priceId) return fromPrice;
  return planFromUnknown(session.metadata?.plan ?? session.metadata?.Plan);
}

export function isPaidCheckoutSession(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

export function planFromSubscription(
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutPlanId | null {
  const priceId = firstPriceIdFromUnknown(sub.items.data[0]?.price);
  const fromPrice = planFromPriceId(priceId, env);
  if (priceId) return fromPrice;
  return planFromUnknown(sub.metadata?.plan);
}

function checkoutCustomerId(session: Stripe.Checkout.Session): string | null {
  if (typeof session.customer === "string" && session.customer.trim()) return session.customer;
  if (session.customer && typeof session.customer === "object" && "id" in session.customer) {
    return session.customer.id;
  }
  return null;
}

function checkoutSubscriptionId(session: Stripe.Checkout.Session): string | null {
  if (typeof session.subscription === "string" && session.subscription.trim()) return session.subscription;
  if (session.subscription && typeof session.subscription === "object" && "id" in session.subscription) {
    return session.subscription.id;
  }
  return null;
}

async function findSeatForCheckout(
  session: Stripe.Checkout.Session,
  subscriptionId: string | null,
): Promise<SeatRecord | null> {
  const store = getSeatStore();
  const byCheckout = await store.getByCheckoutSession(session.id);
  if (byCheckout) return byCheckout;
  if (subscriptionId) {
    const bySub = await store.getBySubscription(subscriptionId);
    if (bySub) return bySub;
  }
  return null;
}

export async function applyCheckoutSession(
  session: Stripe.Checkout.Session,
  event: Stripe.Event | null = null,
): Promise<SeatRecord | null> {
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) return null;
  const expanded = await expandCheckoutIfNeeded(session);
  const plan = planFromCheckout(expanded);
  if (!plan) return null;
  const store = getSeatStore();
  const customerId = checkoutCustomerId(session);
  if (!customerId) return null;
  const subscriptionId = checkoutSubscriptionId(session);
  const existing = await findSeatForCheckout(session, subscriptionId);
  if (!isPaidCheckoutSession(expanded)) return existing;
  const quantity = quantityFromCheckout(expanded, plan);
  if (existing) {
    if (event && isStaleBillingEvent(existing, event.created)) {
      if (existing.stripeCheckoutSessionId === session.id) return existing;
      return store.upsert({
        ...existing,
        stripeCheckoutSessionId: existing.stripeCheckoutSessionId ?? session.id,
        stripeSubscriptionId: existing.stripeSubscriptionId ?? subscriptionId,
      });
    }
    const nextStatus: SeatStatus = existing.status === "canceled" ? "canceled" : "active";
    const next = {
      ...existing,
      email: normalizeEmail(email),
      plan: existing.status === "canceled" ? existing.plan : plan,
      status: nextStatus,
      stripeCustomerId: existing.stripeCustomerId || customerId,
      stripeSubscriptionId: existing.stripeSubscriptionId ?? subscriptionId,
      stripeCheckoutSessionId: existing.stripeCheckoutSessionId ?? session.id,
      stripePriceId: priceIdFromCheckout(expanded) ?? existing.stripePriceId,
      agentQuantity: quantity,
      maxComputers: computersForPurchase(plan, quantity),
    };
    return store.upsert(
      withBillingEventAt(nextStatus === "active" ? clearGrace(next) : next, event?.created),
    );
  }
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
  return store.upsert(withBillingEventAt(seat, event?.created ?? session.created));
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

function holdNowMs(event: Stripe.Event | null): number {
  return eventCreatedMs(event?.created) ?? Date.now();
}

async function persistHeldSeat(
  existing: SeatRecord,
  status: SeatStatus,
  event: Stripe.Event | null,
): Promise<SeatRecord> {
  const store = getSeatStore();
  if (event && isStaleBillingEvent(existing, event.created)) return existing;
  if (existing.status === "canceled" && status !== "canceled") return existing;
  const now = holdNowMs(event);
  const next = status === "active" ? clearGrace({ ...existing, status }) : startGrace({ ...existing, status }, now);
  return store.upsert(withBillingEventAt(next, event?.created));
}

async function findSeatForCustomerOrSubscription(
  subscriptionId: string | null,
  customerId: string | null,
): Promise<SeatRecord | null> {
  const store = getSeatStore();
  if (subscriptionId) {
    const bySub = await store.getBySubscription(subscriptionId);
    if (bySub) return bySub;
  }
  if (!customerId) return null;
  return (await store.listAll()).find((row) => row.stripeCustomerId === customerId) ?? null;
}

export async function applySubscription(
  sub: Stripe.Subscription,
  event: Stripe.Event | null = null,
): Promise<SeatRecord | null> {
  const store = getSeatStore();
  const existing = await store.getBySubscription(sub.id);
  if (existing && event && isStaleBillingEvent(existing, event.created)) return existing;
  const emailRaw =
    typeof sub.customer === "object" && sub.customer && "email" in sub.customer
      ? asString((sub.customer as { email?: unknown }).email)
      : null;
  if (sub.status === "incomplete" || sub.status === "incomplete_expired" || sub.status === "paused") {
    if (!existing) return null;
    return existing;
  }
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
      status: existing.status === "canceled" && status !== "canceled" ? "canceled" : status,
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
    if (next.status === "active") next = clearGrace(next);
    else next = startGrace(next, holdNowMs(event));
    return store.upsert(withBillingEventAt(next, event?.created));
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
  const held = status === "active" ? created : startGrace(created, holdNowMs(event));
  return store.upsert(
    withBillingEventAt(
      {
        ...held,
        agentQuantity: quantity,
        maxComputers: created.plan === "team" ? quantity : entry.computers,
        hoursIncluded:
          created.plan === "team" ? (entry.hoursPerAgent ?? entry.includedHours) * quantity : entry.includedHours,
      },
      event?.created,
    ),
  );
}

export const STRIPE_PAID_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_succeeded",
] as const;

export async function applyStripeEvent(event: Stripe.Event): Promise<SeatRecord | null> {
  if (event.type === "checkout.session.completed") {
    return applyCheckoutSession(event.data.object as Stripe.Checkout.Session, event);
  }
  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    return null;
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.deleted"
  ) {
    return applySubscription(event.data.object as Stripe.Subscription, event);
  }
  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed"
  ) {
    const invoice = event.data.object as Stripe.Invoice;
    const existing = await findSeatForCustomerOrSubscription(
      invoiceSubscriptionId(invoice),
      invoiceCustomerId(invoice),
    );
    if (!existing) return null;
    if (event.type === "invoice.payment_failed") {
      return persistHeldSeat(existing, "past_due", event);
    }
    if (existing.status === "canceled") return existing;
    if (isStaleBillingEvent(existing, event.created)) return existing;
    const quantity = await quantityFromSubscriptionItem(invoiceSubscriptionId(invoice), existing.agentQuantity);
    const entry = PLAN_CATALOG[existing.plan];
    const maxComputers = existing.plan === "team" ? quantity : entry.computers;
    const hoursIncluded =
      existing.plan === "team" ? (entry.hoursPerAgent ?? entry.includedHours) * quantity : entry.includedHours;
    return getSeatStore().upsert(
      withBillingEventAt(
        clearGrace({
          ...existing,
          status: "active",
          agentQuantity: quantity,
          maxComputers,
          hoursIncluded,
        }),
        event.created,
      ),
    );
  }
  if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created" ||
    event.type === "charge.dispute.updated"
  ) {
    const obj = asObject(event.data.object);
    const customerId = obj ? idFromUnknown(obj.customer) : null;
    const existing = await findSeatForCustomerOrSubscription(null, customerId);
    if (!existing) return null;
    if (event.type === "charge.dispute.updated" && asString(obj?.status) === "won") return existing;
    return persistHeldSeat(existing, "past_due", event);
  }
  if (event.type === "charge.dispute.closed") {
    const obj = asObject(event.data.object);
    const customerId = obj ? idFromUnknown(obj.customer) : null;
    const existing = await findSeatForCustomerOrSubscription(null, customerId);
    if (!existing) return null;
    if (asString(obj?.status) === "won") return existing;
    return persistHeldSeat(existing, "past_due", event);
  }
  return null;
}

async function quantityFromSubscriptionItem(subscriptionId: string | null, fallback: number): Promise<number> {
  const client = getStripe();
  if (!subscriptionId || !client) return fallback;
  try {
    const sub = await client.subscriptions.retrieve(subscriptionId);
    const itemQuantity = sub.items.data[0]?.quantity;
    if (typeof itemQuantity !== "number") return fallback;
    return recordedAgentQuantity(itemQuantity);
  } catch {
    return fallback;
  }
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
  bindMetadata?: Record<string, string>;
  expiresAt?: number;
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
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    customer_email: normalizeEmail(input.email),
    client_reference_id: normalizeEmail(input.email),
    line_items: [{ price: priceId, quantity }],
    metadata: {
      plan: input.plan,
      price_id: priceId,
      agent_quantity: String(quantity),
      ...input.bindMetadata,
    },
    subscription_data: {
      metadata: {
        plan: input.plan,
        price_id: priceId,
        agent_quantity: String(quantity),
        ...input.bindMetadata,
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
