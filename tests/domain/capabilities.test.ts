/**
 * Capability helper unit tests. No provider, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_SECRET_BYTES,
  CapabilityExpired,
  CapabilityInvalid,
  CapabilityMissing,
  CapabilityRevoked,
  CrossNodeDenied,
  DEFAULT_PAIR_SCOPES,
  InsufficientScope,
  InvalidScope,
  capabilityAuth,
  extractCapabilityToken,
  hashToken,
  hasScope,
  issueCapability,
  isCapabilityValid,
  parseScopes,
  sharedOperationAuth,
  NO_OPERATION_AUTH,
} from "../../src/lib/computers/index.js";
import type { CapabilityRecord } from "../../src/lib/computers/index.js";

function recordFor(
  token: string,
  overrides: Partial<CapabilityRecord> = {},
): CapabilityRecord {
  const minted = { digest: hashToken(token), issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
  return {
    digest: minted.digest,
    computerId: "comp-noema",
    birdId: "bird-noema",
    flockId: "flock-1",
    scopes: [...DEFAULT_PAIR_SCOPES],
    issuedAt: minted.issuedAt,
    expiresAt: minted.expiresAt,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

describe("capability helpers", () => {
  it("mints a 256-bit secret and matching digest", () => {
    const { token, digest, expiresAt } = issueCapability();
    const raw = Buffer.from(token, "base64url");
    assert.equal(raw.length, CAPABILITY_SECRET_BYTES);
    assert.equal(raw.length, 32);
    assert.equal(digest, hashToken(token));
    assert.ok(expiresAt.getTime() > Date.now());
  });

  it("default pair scopes omit shell", () => {
    assert.ok(DEFAULT_PAIR_SCOPES.includes("exec"));
    assert.ok(DEFAULT_PAIR_SCOPES.includes("fs"));
    assert.equal(DEFAULT_PAIR_SCOPES.includes("shell"), false);
  });

  it("parseScopes rejects unknown scopes", () => {
    assert.throws(() => parseScopes(["exec", "root"]), (err: unknown) => err instanceof InvalidScope);
    assert.deepEqual(parseScopes(["exec", "fs"]), ["exec", "fs"]);
  });

  it("isCapabilityValid accepts a matching bound token", () => {
    const { token } = issueCapability();
    assert.doesNotThrow(() =>
      isCapabilityValid(token, recordFor(token), {
        computerId: "comp-noema",
        birdId: "bird-noema",
        flockId: "flock-1",
        scope: "fs",
      }),
    );
  });

  it("rejects expired, revoked, mismatch, wrong node, wrong scope", () => {
    const { token } = issueCapability();
    assert.throws(
      () => isCapabilityValid(token, recordFor(token, { expiresAt: new Date(Date.now() - 1000) })),
      (err: unknown) => err instanceof CapabilityExpired,
    );
    assert.throws(
      () => isCapabilityValid(token, recordFor(token, { revokedAt: new Date() })),
      (err: unknown) => err instanceof CapabilityRevoked,
    );
    assert.throws(
      () => isCapabilityValid(token, recordFor("other-token")),
      (err: unknown) => err instanceof CapabilityInvalid,
    );
    assert.throws(
      () =>
        isCapabilityValid(token, recordFor(token), {
          computerId: "comp-code",
        }),
      (err: unknown) => err instanceof CrossNodeDenied,
    );
    assert.throws(
      () =>
        isCapabilityValid(token, recordFor(token, { scopes: ["status"] }), {
          scope: "exec",
        }),
      (err: unknown) => err instanceof InsufficientScope,
    );
  });

  it("extractCapabilityToken rejects shared MCP auth and missing tokens", () => {
    assert.throws(
      () => extractCapabilityToken(sharedOperationAuth("xai-team")),
      (err: unknown) => err instanceof CapabilityMissing,
    );
    assert.throws(
      () => extractCapabilityToken(NO_OPERATION_AUTH),
      (err: unknown) => err instanceof CapabilityMissing,
    );
    assert.throws(
      () => extractCapabilityToken(capabilityAuth("")),
      (err: unknown) => err instanceof CapabilityMissing,
    );
    assert.equal(extractCapabilityToken(capabilityAuth("tok")), "tok");
  });

  it("hasScope is exact", () => {
    assert.equal(hasScope(["exec", "fs"], "exec"), true);
    assert.equal(hasScope(["exec", "fs"], "shell"), false);
  });
});
