/**
 * Short-lived, single-computer owner desktop tokens.
 * HMAC-signed so any Vercel instance can verify without process memory.
 * Raw tokens are never stored. Revocation uses desktop-sessions (durable).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DESKTOP_TOKEN_TTL_MS = 10 * 60 * 1000;

export type DesktopMode = "view" | "control";

export type DesktopPayload = {
  v: 1;
  computerId: string;
  email: string;
  subject: string;
  mode: DesktopMode;
  nonce: string;
  exp: number;
  iat: number;
};

export function desktopBindSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const dedicated = env.STAXIONS_BIND_SECRET?.trim() ?? "";
  if (env.NODE_ENV === "production") {
    return dedicated.length >= 32 ? dedicated : null;
  }
  if (dedicated.length >= 32) return dedicated;
  const cookie = env.WORKOS_COOKIE_PASSWORD?.trim() ?? "";
  return cookie.length >= 32 ? cookie : null;
}

function sign(body: string, material: string): string {
  return createHmac("sha256", material).update(body).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function newDesktopNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function encodeDesktopToken(payload: DesktopPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readDesktopToken(token: string, secret: string): DesktopPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!signaturesMatch(sign(body, secret), mac)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<DesktopPayload>;
    if (parsed.v !== 1) return null;
    if (parsed.mode !== "view" && parsed.mode !== "control") return null;
    if (
      typeof parsed.computerId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.iat !== "number"
    ) {
      return null;
    }
    if (!parsed.computerId || !parsed.email || !parsed.subject || !parsed.nonce) return null;
    return {
      v: 1,
      computerId: parsed.computerId,
      email: parsed.email,
      subject: parsed.subject,
      mode: parsed.mode,
      nonce: parsed.nonce,
      exp: parsed.exp,
      iat: parsed.iat,
    };
  } catch {
    return null;
  }
}

export function issueDesktopPayload(input: {
  computerId: string;
  email: string;
  subject: string;
  mode: DesktopMode;
  now?: number;
  ttlMs?: number;
}): DesktopPayload {
  const now = input.now ?? Date.now();
  return {
    v: 1,
    computerId: input.computerId,
    email: input.email.trim().toLowerCase(),
    subject: input.subject,
    mode: input.mode,
    nonce: newDesktopNonce(),
    iat: now,
    exp: now + (input.ttlMs ?? DESKTOP_TOKEN_TTL_MS),
  };
}
