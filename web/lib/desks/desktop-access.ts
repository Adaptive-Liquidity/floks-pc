import { getSeatStore } from "../billing/seats";
import {
  desktopBindSecret,
  encodeDesktopToken,
  issueDesktopPayload,
  readDesktopToken,
  type DesktopMode,
  type DesktopPayload,
} from "./desktop-token";
import { getDesktopSessionStore } from "./desktop-sessions";

export type DesktopAuthFailure = "invalid" | "expired" | "revoked" | "mismatch";

export type OpenDesktopResult =
  | { ok: true; token: string; payload: DesktopPayload }
  | { ok: false; reason: DesktopAuthFailure };

export async function emailOwnsComputer(email: string, computerId: string): Promise<boolean> {
  if (!computerId) return false;
  const seats = await getSeatStore().listByEmail(email);
  return seats.some(
    (seat) => seat.computerId === computerId || seat.computerIds.includes(computerId),
  );
}

export async function issueOwnerDesktopToken(input: {
  computerId: string;
  email: string;
  subject: string;
  mode: DesktopMode;
  now?: number;
}): Promise<OpenDesktopResult> {
  const secret = desktopBindSecret();
  if (!secret) return { ok: false, reason: "invalid" };
  const now = input.now ?? Date.now();
  const payload = issueDesktopPayload({
    computerId: input.computerId,
    email: input.email,
    subject: input.subject,
    mode: input.mode,
    now,
  });
  await getDesktopSessionStore().save({
    nonce: payload.nonce,
    computerId: payload.computerId,
    email: payload.email,
    subject: payload.subject,
    mode: payload.mode,
    expiresAt: payload.exp,
    revokedAt: null,
  });
  return { ok: true, token: encodeDesktopToken(payload, secret), payload };
}

export async function readOwnerDesktopToken(input: {
  token: string;
  computerId: string;
  email: string;
  subject: string;
  now?: number;
}): Promise<{ ok: true; payload: DesktopPayload } | { ok: false; reason: DesktopAuthFailure }> {
  const secret = desktopBindSecret();
  if (!secret) return { ok: false, reason: "invalid" };
  const payload = readDesktopToken(input.token, secret);
  if (!payload) return { ok: false, reason: "invalid" };
  const now = input.now ?? Date.now();
  if (payload.exp <= now) return { ok: false, reason: "expired" };
  if (payload.computerId !== input.computerId) return { ok: false, reason: "mismatch" };
  if (payload.email !== input.email.trim().toLowerCase()) return { ok: false, reason: "mismatch" };
  if (payload.subject !== input.subject) return { ok: false, reason: "mismatch" };
  const row = await getDesktopSessionStore().get(payload.nonce);
  if (row) {
    if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };
    if (row.computerId !== payload.computerId || row.email !== payload.email) {
      return { ok: false, reason: "mismatch" };
    }
  }
  // Missing row: HMAC + owner session still authorize (other Vercel instance
  // may have issued it; do not require process-local memory).
  return { ok: true, payload };
}

export async function revokeOwnerDesktopToken(token: string, now = Date.now()): Promise<boolean> {
  const secret = desktopBindSecret();
  if (!secret) return false;
  const payload = readDesktopToken(token, secret);
  if (!payload) return false;
  return getDesktopSessionStore().revoke(payload.nonce, now);
}

export async function rotateOwnerDesktopToken(input: {
  token: string;
  computerId: string;
  email: string;
  subject: string;
  mode: DesktopMode;
  now?: number;
}): Promise<OpenDesktopResult> {
  const now = input.now ?? Date.now();
  const current = await readOwnerDesktopToken({
    token: input.token,
    computerId: input.computerId,
    email: input.email,
    subject: input.subject,
    now,
  });
  if (!current.ok) return current;
  await revokeOwnerDesktopToken(input.token, now);
  return issueOwnerDesktopToken({
    computerId: input.computerId,
    email: input.email,
    subject: input.subject,
    mode: input.mode,
    now,
  });
}
