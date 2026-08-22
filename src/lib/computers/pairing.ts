/**
 * Pair-code helpers.
 * Codes are one-use, short-TTL, and only digests are stored.
 * Format recommendation from plan: ABCD-EFGH-JK (≥ 50 bits entropy).
 */

import { createHash, randomBytes } from "node:crypto";
import { PairCodeInvalid } from "./errors.js";

const PAIR_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export interface PairCodeMaterial {
  /** Human-readable code shown to the user / Bot */
  code: string;
  /** SHA-256 hex digest — the only thing that should be persisted */
  digest: string;
  /** Absolute expiry timestamp */
  expiresAt: Date;
}

/** Generate a fresh one-use pair code + its digest + expiry. */
export function generatePairCode(ttlMs: number = PAIR_CODE_TTL_MS): PairCodeMaterial {
  // ~52 bits of entropy in a readable form
  const raw = randomBytes(8);
  const chars: string[] = [];
  for (let i = 0; i < 10; i++) {
    chars.push(PAIR_CODE_ALPHABET[raw[i % 8]! % PAIR_CODE_ALPHABET.length]!);
  }
  const code = `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 10).join("")}`;
  const digest = hashPairCode(code);
  const expiresAt = new Date(Date.now() + ttlMs);
  return { code, digest, expiresAt };
}

/** SHA-256 hex digest of a normalized pair code. */
export function hashPairCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, "");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export interface PairCodeRecord {
  digest: string;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
}

/**
 * Validate a presented code against a stored record.
 * Throws PairCodeInvalid on any failure (expired, already used, mismatch, too many attempts).
 * On success the caller should mark usedAt = now and persist.
 */
export function validatePairCode(
  presentedCode: string,
  record: PairCodeRecord,
  maxAttempts: number = 5,
): void {
  if (record.usedAt !== null) {
    throw new PairCodeInvalid("already used");
  }
  if (record.attemptCount >= maxAttempts) {
    throw new PairCodeInvalid("too many attempts");
  }
  if (Date.now() > record.expiresAt.getTime()) {
    throw new PairCodeInvalid("expired");
  }
  const presentedDigest = hashPairCode(presentedCode);
  if (presentedDigest !== record.digest) {
    throw new PairCodeInvalid("mismatch");
  }
}
