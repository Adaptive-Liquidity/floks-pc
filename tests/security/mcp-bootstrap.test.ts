/**
 * Local MCP control-plane bootstrap (operator stdout pair code).
 * Not an MCP tool. FakeProvider only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.js";
import { ComputerError } from "../../src/lib/computers/errors.js";
import {
  assertSafeMcpBind,
  bootstrapLocalComputer,
} from "../../src/mcp-server.js";

describe("MCP local bootstrap", () => {
  it("does nothing unless FLOK_MCP_BOOTSTRAP is set", async () => {
    const service = new ComputerService(new FakeProvider());
    const result = await bootstrapLocalComputer(service, {});
    assert.equal(result, null);
    assert.equal(service.list().length, 0);
  });

  it("defaults bird-local/flock-local when identity env is omitted", async () => {
    const service = new ComputerService(new FakeProvider());
    const result = await bootstrapLocalComputer(service, { FLOK_MCP_BOOTSTRAP: "1" });
    assert.ok(result);
    assert.equal(result.birdId, "bird-local");
    assert.equal(result.flockId, "flock-local");
    await assert.rejects(() =>
      service.pair(result.pairCode, { birdId: "other-bird", flockId: "flock-local" }),
    );
    const redeemed = await service.pair(result.pairCode, {
      birdId: "bird-local",
      flockId: "flock-local",
    });
    assert.equal(redeemed.computerHandle, result.computerId);
  });

  it("provisions one computer and returns a one-time pair code", async () => {
    const service = new ComputerService(new FakeProvider());
    const result = await bootstrapLocalComputer(service, {
      FLOK_MCP_BOOTSTRAP: "1",
      FLOK_MCP_BOOTSTRAP_BIRD_ID: "bird-local",
      FLOK_MCP_BOOTSTRAP_FLOCK_ID: "flock-local",
    });
    assert.ok(result);
    assert.equal(result.birdId, "bird-local");
    assert.equal(result.flockId, "flock-local");
    assert.ok(result.pairCode.length > 0);
    assert.equal(service.list().length, 1);
    assert.equal(service.list()[0]?.id, result.computerId);

    const redeemed = await service.pair(result.pairCode, {
      birdId: "bird-local",
      flockId: "flock-local",
    });
    assert.ok(redeemed.token.length > 0);
    assert.equal(redeemed.computerHandle, result.computerId);
  });

  it("reuses an existing bird instead of throwing DuplicateComputer", async () => {
    const service = new ComputerService(new FakeProvider());
    const env = {
      FLOK_MCP_BOOTSTRAP: "1",
      FLOK_MCP_BOOTSTRAP_BIRD_ID: "bird-local",
      FLOK_MCP_BOOTSTRAP_FLOCK_ID: "flock-local",
    };
    const first = await bootstrapLocalComputer(service, env);
    const second = await bootstrapLocalComputer(service, env);
    assert.ok(first && second);
    assert.equal(second.computerId, first.computerId);
    assert.equal(service.list().length, 1);
    await assert.rejects(() => service.pair(first.pairCode, {
      birdId: "bird-local",
      flockId: "flock-local",
    }));
    const redeemed = await service.pair(second.pairCode, {
      birdId: "bird-local",
      flockId: "flock-local",
    });
    assert.equal(redeemed.computerHandle, first.computerId);
  });

  it("refuses a flock mismatch on an existing bird", async () => {
    const service = new ComputerService(new FakeProvider());
    await bootstrapLocalComputer(service, {
      FLOK_MCP_BOOTSTRAP: "1",
      FLOK_MCP_BOOTSTRAP_BIRD_ID: "bird-local",
      FLOK_MCP_BOOTSTRAP_FLOCK_ID: "flock-local",
    });
    await assert.rejects(
      () =>
        bootstrapLocalComputer(service, {
          FLOK_MCP_BOOTSTRAP: "1",
          FLOK_MCP_BOOTSTRAP_BIRD_ID: "bird-local",
          FLOK_MCP_BOOTSTRAP_FLOCK_ID: "flock-other",
        }),
      (err: unknown) => err instanceof ComputerError && err.code === "BOOTSTRAP_FLOCK_MISMATCH",
    );
  });

  it("allows loopback without wrapper auth and refuses non-loopback", () => {
    assert.doesNotThrow(() => assertSafeMcpBind("127.0.0.1", undefined));
    assert.doesNotThrow(() => assertSafeMcpBind("::1", undefined));
    assert.throws(
      () => assertSafeMcpBind("localhost", undefined),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_BIND_UNAUTHENTICATED",
    );
    assert.throws(
      () => assertSafeMcpBind("0.0.0.0", undefined),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_BIND_UNAUTHENTICATED",
    );
    assert.throws(
      () => assertSafeMcpBind("::", undefined),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_BIND_UNAUTHENTICATED",
    );
    assert.throws(
      () => assertSafeMcpBind("0.0.0.0", ""),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_BIND_UNAUTHENTICATED",
    );
    assert.throws(
      () => assertSafeMcpBind("0.0.0.0", "   "),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_BIND_UNAUTHENTICATED",
    );
    assert.doesNotThrow(() => assertSafeMcpBind("0.0.0.0", "wrapper-token"));
  });
});
