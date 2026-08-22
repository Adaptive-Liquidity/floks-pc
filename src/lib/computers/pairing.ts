/**
 * Pair-code helpers.
 * Codes are one-use, short-TTL, and only digests are stored.
 * Format: ABCD-EFGH-JK (≥ 50 bits entropy). Independent of Flok join codes.
 */

import { randomBytes } from "node:crypto";
import { PairCodeInvalid } from "./errors.js";
import { digestEquals, sha256Hex } from "./digest.js";

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const PAIR_CODE_MAX_ATTEMPTS = 5;
export const PAIR_CODE_CHAR_COUNT = 10;
const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars; no 0/O/1/I

export interface PairCodeMaterial {
  /** Human-readable code shown to the user / Bot — never persist this */
  code: string;
  /** SHA-256 hex digest — the only thing that should be persisted */
  digest: string;
  /** Absolute expiry timestamp */
  expiresAt: Date;
}

function randomAlphabetChars(count: number): string {
  const alphabetLen = PAIR_CODE_ALPHABET.length;
  const limit = 256 - (256 % alphabetLen);
  const chars: string[] = [];
  while (chars.length < count) {
    const buf = randomBytes(count);
    for (const byte of buf) {
      if (byte < limit) {
        chars.push(PAIR_CODE_ALPHABET[byte % alphabetLen]!);
        if (chars.length === count) break;
      }
    }
  }
  return chars.join("");
}

/** Generate a fresh one-use pair code + its digest + expiry. */
export function generatePairCode(ttlMs: number = PAIR_CODE_TTL_MS): PairCodeMaterial {
  const raw = randomAlphabetChars(PAIR_CODE_CHAR_COUNT);
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`;
  const digest = hashPairCode(code);
  const expiresAt = new Date(Date.now() + ttlMs);
  return { code, digest, expiresAt };
}

/** SHA-256 hex digest of a normalized pair code. */
export function hashPairCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, "");
  return sha256Hex(normalized);
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
 * On success the caller must mark usedAt = now and persist — codes are one-time-use.
 */
export function validatePairCode(
  presentedCode: string,
  record: PairCodeRecord,
  maxAttempts: number = PAIR_CODE_MAX_ATTEMPTS,
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
  if (!digestEquals(presentedDigest, record.digest)) {
    throw new PairCodeInvalid("mismatch");
  }
}
