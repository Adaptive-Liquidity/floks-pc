/**
 * Pair-code unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generatePairCode,
  hashPairCode,
  validatePairCode,
  PairCodeInvalid,
} from "../../src/lib/computers/index.js";

describe("pairing", () => {
  it("generates a readable code and matching digest", () => {
    const { code, digest, expiresAt } = generatePairCode();
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    assert.equal(digest, hashPairCode(code));
    assert.ok(expiresAt.getTime() > Date.now());
  });

  it("hash is case-insensitive and whitespace-tolerant", () => {
    const { code } = generatePairCode();
    const d1 = hashPairCode(code);
    const d2 = hashPairCode(code.toLowerCase());
    const d3 = hashPairCode(`  ${code}  `);
    assert.equal(d1, d2);
    assert.equal(d1, d3);
  });

  it("validate succeeds for a fresh matching code", () => {
    const { code, digest, expiresAt } = generatePairCode();
    assert.doesNotThrow(() =>
      validatePairCode(code, {
        digest,
        expiresAt,
        usedAt: null,
        attemptCount: 0,
      }),
    );
  });

  it("rejects already-used code", () => {
    const { code, digest, expiresAt } = generatePairCode();
    assert.throws(
      () =>
        validatePairCode(code, {
          digest,
          expiresAt,
          usedAt: new Date(),
          attemptCount: 0,
        }),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });

  it("rejects expired code", () => {
    const { code, digest } = generatePairCode();
    assert.throws(
      () =>
        validatePairCode(code, {
          digest,
          expiresAt: new Date(Date.now() - 1000),
          usedAt: null,
          attemptCount: 0,
        }),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });

  it("rejects mismatch", () => {
    const { digest, expiresAt } = generatePairCode();
    assert.throws(
      () =>
        validatePairCode("XXXX-YYYY-ZZ", {
          digest,
          expiresAt,
          usedAt: null,
          attemptCount: 0,
        }),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });

  it("rejects too many attempts", () => {
    const { code, digest, expiresAt } = generatePairCode();
    assert.throws(
      () =>
        validatePairCode(code, {
          digest,
          expiresAt,
          usedAt: null,
          attemptCount: 5,
        }),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });
});
