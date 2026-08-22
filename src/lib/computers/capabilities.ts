/**
 * Capability token helpers.
 * Tokens are 256-bit random values; only digests are stored.
 * Bound to exact computer_id + bird_id + flock_id. Scoped, expiring, revocable.
 *
 * Shared account / MCP authentication is never sufficient on its own.
 */

import { randomBytes } from "node:crypto";
import {
  CapabilityExpired,
  CapabilityInvalid,
  CapabilityMissing,
  CapabilityRevoked,
  CrossNodeDenied,
  InsufficientScope,
  InvalidScope,
} from "./errors.js";
import { digestEquals, sha256Hex } from "./digest.js";
import type {
  CapabilityScope,
  ComputerCapability,
  ComputerOperationAuth,
  SharedAccountAuth,
} from "./types.js";
import { CAPABILITY_SCOPES } from "./types.js";

export const CAPABILITY_SECRET_BYTES = 32; // 256-bit
export const DEFAULT_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const DEFAULT_PAIR_SCOPES: readonly CapabilityScope[] = [
  "status",
  "exec",
  "fs",
  "observe",
  "act",
  "lifecycle",
];

export interface CapabilityMaterial {
  /** Opaque token returned once to the Bot — never stored in plaintext */
  token: string;
  /** SHA-256 hex digest — the only thing persisted */
  digest: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Mint a 256-bit capability secret + its digest. Never persist `token`. */
export function issueCapability(
  ttlMs: number = DEFAULT_CAPABILITY_TTL_MS,
): CapabilityMaterial {
  const raw = randomBytes(CAPABILITY_SECRET_BYTES);
  const token = raw.toString("base64url");
  const digest = hashToken(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);
  return { token, digest, issuedAt, expiresAt };
}

/** SHA-256 hex digest of a capability token. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function parseScopes(scopes: readonly string[]): CapabilityScope[] {
  const allowed = new Set<string>(CAPABILITY_SCOPES);
  const out: CapabilityScope[] = [];
  for (const scope of scopes) {
    if (!allowed.has(scope)) {
      throw new InvalidScope(scope);
    }
    const typed = scope as CapabilityScope;
    if (!out.includes(typed)) out.push(typed);
  }
  return out;
}

export function copyScopes(scopes: readonly CapabilityScope[]): CapabilityScope[] {
  return [...scopes];
}

export function hasScope(
  scopes: readonly string[],
  required: CapabilityScope,
): boolean {
  return scopes.includes(required);
}

export interface CapabilityRecord {
  capabilityId: string;
  digest: string;
  computerId: string;
  birdId: string;
  flockId: string;
  scopes: readonly string[];
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface CapabilityExpectation {
  computerId: string;
  birdId: string;
  flockId: string;
  scope?: CapabilityScope;
}

export function toCapabilityRecord(cap: ComputerCapability): CapabilityRecord {
  return {
    capabilityId: cap.id,
    digest: cap.tokenDigest,
    computerId: cap.computerId,
    birdId: cap.birdId,
    flockId: cap.flockId,
    scopes: copyScopes(cap.scopes),
    issuedAt: cap.issuedAt,
    expiresAt: cap.expiresAt,
    revokedAt: cap.revokedAt,
    lastUsedAt: cap.lastUsedAt,
  };
}

/**
 * Validate a presented token against a stored capability record.
 * Fail-closed with a specific error. Possession (digest) is checked before
 * lifecycle state so callers without the token cannot probe revoked/expired.
 * Binding (computer/bird/flock) is mandatory. Caller updates lastUsedAt on success.
 */
export function isCapabilityValid(
  presentedToken: string,
  record: CapabilityRecord,
  expected: CapabilityExpectation,
): void {
  if (presentedToken.length === 0) {
    throw new CapabilityMissing("missing capability");
  }
  const presentedDigest = hashToken(presentedToken);
  if (!digestEquals(presentedDigest, record.digest)) {
    throw new CapabilityInvalid("mismatch");
  }
  if (record.revokedAt !== null) {
    throw new CapabilityRevoked(record.capabilityId);
  }
  if (Date.now() > record.expiresAt.getTime()) {
    throw new CapabilityExpired(record.capabilityId);
  }
  if (record.computerId !== expected.computerId) {
    throw new CrossNodeDenied(record.computerId, expected.computerId);
  }
  if (record.birdId !== expected.birdId) {
    throw new CrossNodeDenied(record.computerId, expected.computerId);
  }
  if (record.flockId !== expected.flockId) {
    throw new CrossNodeDenied(record.computerId, expected.computerId);
  }
  if (expected.scope !== undefined && !hasScope(record.scopes, expected.scope)) {
    throw new InsufficientScope(expected.scope, record.scopes);
  }
}

export function capabilityAuth(token: string): ComputerOperationAuth {
  return { kind: "capability", token };
}

export function sharedAccountAuth(accountId: string): SharedAccountAuth {
  return { accountId };
}

export function sharedOperationAuth(accountId: string): ComputerOperationAuth {
  return { kind: "shared", accountId };
}

export const NO_OPERATION_AUTH: ComputerOperationAuth = { kind: "none" };

export function extractCapabilityToken(auth: ComputerOperationAuth): string {
  if (auth.kind === "shared") {
    throw new CapabilityMissing("shared MCP auth is not sufficient");
  }
  if (auth.kind === "none") {
    throw new CapabilityMissing("missing capability");
  }
  if (auth.kind !== "capability" || auth.token.length === 0) {
    throw new CapabilityMissing("missing capability");
  }
  return auth.token;
}
