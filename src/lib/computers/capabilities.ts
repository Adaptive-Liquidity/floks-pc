/**
 * Capability token helpers.
 * Tokens are 256-bit random values; only digests are stored.
 * Scoped to one computer_id + bird_id.
 */

import { createHash, randomBytes } from "node:crypto";
import { CapabilityRevoked } from "./errors.js";

const DEFAULT_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CapabilityMaterial {
  /** Opaque token returned once to the Bot — never stored in plaintext */
  token: string;
  /** SHA-256 hex digest — the only thing persisted */
  digest: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Issue a new capability token + its digest. */
export function issueCapability(
  ttlMs: number = DEFAULT_CAPABILITY_TTL_MS,
): CapabilityMaterial {
  const token = randomBytes(32).toString("base64url");
  const digest = hashToken(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);
  return { token, digest, issuedAt, expiresAt };
}

/** SHA-256 hex digest of a capability token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface CapabilityRecord {
  digest: string;
  computerId: string;
  birdId: string;
  scopes: string[];
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * Validate a presented token against a stored capability record.
 * Throws CapabilityRevoked on any failure.
 * On success the caller should update lastUsedAt.
 */
export function isCapabilityValid(
  presentedToken: string,
  record: CapabilityRecord,
  expectedComputerId?: string,
  expectedBirdId?: string,
): void {
  if (record.revokedAt !== null) {
    throw new CapabilityRevoked(record.digest.slice(0, 8));
  }
  if (Date.now() > record.expiresAt.getTime()) {
    throw new CapabilityRevoked("expired");
  }
  if (expectedComputerId && record.computerId !== expectedComputerId) {
    throw new CapabilityRevoked("wrong computer");
  }
  if (expectedBirdId && record.birdId !== expectedBirdId) {
    throw new CapabilityRevoked("wrong bird");
  }
  const presentedDigest = hashToken(presentedToken);
  if (presentedDigest !== record.digest) {
    throw new CapabilityRevoked("mismatch");
  }
}
