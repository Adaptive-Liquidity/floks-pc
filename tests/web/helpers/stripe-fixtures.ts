import type Stripe from "stripe";

export const TEST_PRICES = {
  personal: "price_personal_test",
  pro: "price_pro_test",
  team: "price_team_test",
} as const;

export function useTestPriceEnv(): void {
  process.env.STRIPE_PRICE_PERSONAL = TEST_PRICES.personal;
  process.env.STRIPE_PRICE_PRO = TEST_PRICES.pro;
  process.env.STRIPE_PRICE_TEAM = TEST_PRICES.team;
}

export function stripeEvent<T extends string>(
  type: T,
  object: Record<string, unknown>,
  extras: { id?: string; created?: number } = {},
): Stripe.Event {
  return {
    id: extras.id ?? `evt_${type.replace(/[^\w]/g, "_")}_${extras.created ?? 1_700_000_000}`,
    object: "event",
    type,
    created: extras.created ?? 1_700_000_000,
    data: { object },
    api_version: "2025-04-30.basil",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  } as Stripe.Event;
}

export function checkoutSessionFixture(input: {
  id: string;
  email: string;
  plan?: "personal" | "pro" | "team";
  priceId?: string;
  quantity?: number;
  customer?: string;
  subscription?: string;
  paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
  metadata?: Record<string, string>;
  created?: number;
}): Stripe.Checkout.Session {
  const plan = input.plan ?? "personal";
  const priceId = input.priceId ?? TEST_PRICES[plan];
  const quantity = input.quantity ?? 1;
  return {
    id: input.id,
    object: "checkout.session",
    amount_total: 2900,
    customer: input.customer ?? `cus_${input.id}`,
    customer_email: input.email,
    customer_details: { email: input.email },
    subscription: input.subscription ?? `sub_${input.id}`,
    payment_status: input.paymentStatus ?? "paid",
    created: input.created ?? 1_700_000_000,
    metadata: {
      plan,
      price_id: priceId,
      agent_quantity: String(quantity),
      ...input.metadata,
    },
    line_items: { data: [{ price: { id: priceId }, quantity }] },
  } as unknown as Stripe.Checkout.Session;
}

export function paidCheckoutEvent(input: {
  id: string;
  email: string;
  plan?: "personal" | "pro" | "team";
  priceId?: string;
  quantity?: number;
  metadata?: Record<string, string>;
  created?: number;
  eventId?: string;
}): Stripe.Event {
  const session = checkoutSessionFixture(input);
  return stripeEvent("checkout.session.completed", session as unknown as Record<string, unknown>, {
    id: input.eventId ?? `evt_${input.id}`,
    created: input.created,
  });
}
