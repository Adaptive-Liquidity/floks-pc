/**
 * L3 private-beta safety caps. Unpaid. FakeProvider. No L7 billing.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BetaInviteRequired,
  BetaRegistry,
  BetaStoreRequired,
  ComputerError,
  ComputerService,
  FakeProvider,
  MemoryBetaStore,
  MemoryControlPlaneStore,
  QuotaExceeded,
  BETA_COST_WARNING,
  BETA_LIMITATIONS,
  knownLimitationsMarkdown,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";

describe("L3 private beta caps", () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = new FakeProvider();
  });

  it("keeps eight MCP tools and does not add destroy", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
    assert.equal(MCP_TOOL_NAMES.includes("computer_destroy" as never), false);
  });

  it("refuses beta provision without a durable store", async () => {
    const service = new ComputerService(provider, {
      ownerId: "owner-a",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 60_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: new BetaRegistry(new MemoryBetaStore()),
    });
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-a", flockId: "flock-a" }),
      (err: unknown) => err instanceof BetaStoreRequired,
    );
  });

  it("refuses uninvited owners and allows after operator approval", async () => {
    const registry = new BetaRegistry(new MemoryBetaStore());
    const service = new ComputerService(provider, {
      store: new MemoryControlPlaneStore(),
      ownerId: "owner-a",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 60_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: registry,
    });
    await registry.hydrate();
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-a", flockId: "flock-a" }),
      (err: unknown) => err instanceof BetaInviteRequired,
    );
    await service.waitlistBetaOwner("owner-a");
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-a", flockId: "flock-a" }),
      (err: unknown) => err instanceof BetaInviteRequired,
    );
    await service.approveBetaOwner("owner-a");
    const computer = await service.requestComputer({
      birdId: "bird-a",
      flockId: "flock-a",
    });
    assert.equal(computer.state, "ready");
    assert.equal(service.operatorSnapshot().beta.enabled, true);
    assert.match(service.operatorSnapshot().beta.costWarning, /does not meter/);
  });

  it("enforces a small per-user active-machine cap", async () => {
    const registry = new BetaRegistry(new MemoryBetaStore());
    await registry.approveOwner("owner-a");
    const service = new ComputerService(provider, {
      store: new MemoryControlPlaneStore(),
      ownerId: "owner-a",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 60_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: registry,
    });
    await service.requestComputer({ birdId: "bird-1", flockId: "flock-a" });
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-2", flockId: "flock-a" }),
      (err: unknown) => err instanceof QuotaExceeded && err.code === "QUOTA_EXCEEDED",
    );
  });

  it("auto-shuts idle computers so a new one can be created under the cap", async () => {
    const registry = new BetaRegistry(new MemoryBetaStore());
    await registry.approveOwner("owner-a");
    let now = 1_000_000;
    const service = new ComputerService(provider, {
      store: new MemoryControlPlaneStore(),
      ownerId: "owner-a",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 5_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: registry,
      now: () => now,
    });
    const first = await service.requestComputer({
      birdId: "bird-old",
      flockId: "flock-a",
    });
    now += 10_000;
    const destroyed = await service.sweepIdle(now);
    assert.equal(destroyed.length, 1);
    assert.equal((await service.get(first.id)).state, "deleted");
    const second = await service.requestComputer({
      birdId: "bird-new",
      flockId: "flock-a",
    });
    assert.equal(second.state, "ready");
  });

  it("debug packet omits tokens, pair codes, screenshots, and providerRef", async () => {
    const registry = new BetaRegistry(new MemoryBetaStore());
    await registry.approveOwner("owner-a");
    const service = new ComputerService(provider, {
      store: new MemoryControlPlaneStore(),
      ownerId: "owner-a",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 60_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: registry,
    });
    const computer = await service.requestComputer({
      birdId: "bird-dbg",
      flockId: "flock-a",
    });
    const issued = await service.issuePairCode(computer.id);
    await service.pair(issued.code, { birdId: "bird-dbg", flockId: "flock-a" });
    const packet = service.debugPacket();
    const blob = JSON.stringify(packet);
    assert.equal(blob.includes(issued.code), false);
    assert.doesNotMatch(blob, /tokenDigest/);
    assert.doesNotMatch(blob, /screenshotBase64/);
    assert.doesNotMatch(blob, /"providerRef"/);
    assert.ok(Array.isArray(packet.limitations));
    assert.ok((packet.limitations as string[]).some((l) => /click_element/i.test(l)));
  });

  it("known-limitations copy names the L3 must-say constraints", () => {
    const md = knownLimitationsMarkdown();
    assert.match(md, /click_element/);
    assert.match(md, /proxies|residential/i);
    assert.match(md, /Production scale is not proven/);
    assert.match(md, /bot-detection/);
    assert.match(md, /exec\/files/);
    assert.ok(BETA_LIMITATIONS.length >= 6);
    assert.doesNotMatch(md, /Nexus|AEON|Graphiti/);
    const file = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../docs/computers/KNOWN_LIMITATIONS.md"),
      "utf8",
    );
    assert.match(file, /click_element/);
    assert.match(file, /Production scale is not proven/);
  });

  it("local/dev without beta still provisions in-memory", async () => {
    const service = new ComputerService(provider);
    const computer = await service.requestComputer({
      birdId: "bird-dev",
      flockId: "flock-dev",
    });
    assert.equal(computer.state, "ready");
    assert.equal(service.operatorSnapshot().beta.enabled, false);
  });
});
