import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG, type CheckoutPlanId } from "./catalog";
import { getPendingBindStore, type PendingBind } from "./pending-binds";

export const BUY_LINK_TTL_MS = 30 * 60 * 1000;

export const NO_COMPUTER_MESSAGE =
  "No computer yet. Open this link to choose a plan and pay. It connects to this Bot automatically.";

export type BuyPayload = {
  v: 1;
  email: string;
  subject: string;
  flock: string;
  clientId: string;
  plan: CheckoutPlanId;
  nonce: string;
  exp: number;
};

export type OpenBuyResult =
  | { ok: true; payload: BuyPayload }
  | { ok: false; reason: "invalid" | "expired" | "used" };

export function checkoutPlanCards(): Array<{ id: CheckoutPlanId; name: string; price_label: string }> {
  return CHECKOUT_PLAN_IDS.map((id) => ({
    id,
    name: PLAN_CATALOG[id].name,
    price_label: PLAN_CATALOG[id].priceLabel,
  }));
}

export function parseCheckoutPlan(value: unknown): CheckoutPlanId | null {
  if (value === "personal" || value === "pro" || value === "team") return value;
  return null;
}

function bindSecret(): string | null {
  const dedicated = process.env.STAXIONS_BIND_SECRET?.trim() ?? "";
  if (dedicated.length >= 32) return dedicated;
  const cookie = process.env.WORKOS_COOKIE_PASSWORD?.trim() ?? "";
  if (cookie.length >= 32) return cookie;
  return null;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readBuyToken(token: string, now = Date.now()): BuyPayload | null {
  const secret = bindSecret();
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!signaturesMatch(sign(body, secret), mac)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<BuyPayload>;
    const plan = parseCheckoutPlan(parsed.plan);
    if (parsed.v !== 1 || !plan) return null;
    if (
      typeof parsed.email !== "string" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.flock !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp <= now) return null;
    return {
      v: 1,
      email: parsed.email,
      subject: parsed.subject,
      flock: parsed.flock,
      clientId: parsed.clientId,
      plan,
      nonce: parsed.nonce,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

function payloadMatches(row: PendingBind, payload: BuyPayload): boolean {
  return (
    row.nonce === payload.nonce &&
    row.clientId === payload.clientId &&
    row.subject === payload.subject &&
    row.flock === payload.flock &&
    row.plan === payload.plan &&
    row.email === payload.email &&
    row.expiresAt === payload.exp
  );
}

export async function createBuyLink(input: {
  origin: string;
  email: string;
  subject: string;
  flock: string;
  clientId: string;
  plan: CheckoutPlanId;
  now?: number;
}): Promise<{ url: string; nonce: string; exp: number }> {
  const secret = bindSecret();
  if (!secret) throw new Error("STAXIONS_BIND_SECRET or WORKOS_COOKIE_PASSWORD is required to sign checkout");
  const now = input.now ?? Date.now();
  const exp = now + BUY_LINK_TTL_MS;
  const nonce = randomBytes(16).toString("base64url");
  const email = input.email.trim().toLowerCase();
  const payload: BuyPayload = {
    v: 1,
    email,
    subject: input.subject,
    flock: input.flock,
    clientId: input.clientId,
    plan: input.plan,
    nonce,
    exp,
  };
  await getPendingBindStore().save({
    nonce,
    clientId: input.clientId,
    subject: input.subject,
    flock: input.flock,
    plan: input.plan,
    email,
    expiresAt: exp,
    openedAt: null,
    usedAt: null,
  });
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${body}.${sign(body, secret)}`;
  const url = new URL("/buy", input.origin);
  url.searchParams.set("t", token);
  return { url: url.toString(), nonce, exp };
}

export async function openBuyToken(token: string, now = Date.now()): Promise<OpenBuyResult> {
  const secret = bindSecret();
  if (!secret) return { ok: false, reason: "invalid" };
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!signaturesMatch(sign(body, secret), mac)) return { ok: false, reason: "invalid" };
  let parsed: Partial<BuyPayload>;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<BuyPayload>;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const plan = parseCheckoutPlan(parsed.plan);
  if (
    parsed.v !== 1 ||
    !plan ||
    typeof parsed.email !== "string" ||
    typeof parsed.subject !== "string" ||
    typeof parsed.flock !== "string" ||
    typeof parsed.clientId !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.exp !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }
  const payload: BuyPayload = {
    v: 1,
    email: parsed.email,
    subject: parsed.subject,
    flock: parsed.flock,
    clientId: parsed.clientId,
    plan,
    nonce: parsed.nonce,
    exp: parsed.exp,
  };
  if (payload.exp <= now) return { ok: false, reason: "expired" };
  const row = await getPendingBindStore().get(payload.nonce);
  if (!row || !payloadMatches(row, payload)) return { ok: false, reason: "invalid" };
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  const claim = await getPendingBindStore().claimOpen(payload.nonce, now);
  if (claim === "ok") return { ok: true, payload };
  if (claim === "expired") return { ok: false, reason: "expired" };
  if (claim === "used") return { ok: false, reason: "used" };
  return { ok: false, reason: "invalid" };
}
