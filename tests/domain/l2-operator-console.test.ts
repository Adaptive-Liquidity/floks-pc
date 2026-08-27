/**
 * L2 Live Node Console: operator views over ComputerService.
 * Unpaid. FakeProvider. No new MCP tools. No screenshot persistence.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerError,
  ComputerService,
  FakeProvider,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";
import {
  buildOperatorComputerView,
  summarizeAccessibility,
} from "../../src/lib/operator/view.js";

const FLOCK = "flock-local";

describe("L2 operator console domain", () => {
  let provider: FakeProvider;
  let service: ComputerService;

  beforeEach(() => {
    provider = new FakeProvider();
    service = new ComputerService(provider);
  });

  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("lists bots with pair/state and never returns capability tokens or pair codes", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-alpha",
      flockId: FLOCK,
    });
    const issued = await service.issuePairCode(computer.id);
    assert.match(issued.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    await service.pair(issued.code, { birdId: "bird-alpha", flockId: FLOCK });

    const snap = service.operatorSnapshot();
    assert.equal(snap.computers.length, 1);
    const view = snap.computers[0];
    assert.ok(view);
    assert.equal(view.birdId, "bird-alpha");
    assert.equal(view.pairStatus, "paired");
    assert.equal(view.state, "ready");
    assert.equal(view.provider, "fake");
    assert.ok(view.providerRef);
    assert.ok(view.scopes.includes("observe"));
    assert.ok(!view.scopes.includes("shell"));
    const blob = JSON.stringify(snap);
    assert.equal(blob.includes(issued.code), false);
    assert.doesNotMatch(blob, /tokenDigest/);
    assert.match(blob, /"cost":\{"metered":false/);
  });

  it("operator observe is control-plane (no bot token) and does not persist screenshots", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-obs",
      flockId: FLOCK,
    });
    const obs = await service.operatorObserve(computer.id, {
      includeAccessibility: true,
      includeScreenshot: true,
    });
    assert.equal(obs.screenWidth, 1280);
    assert.equal(obs.screenHeight, 720);
    assert.equal(obs.hasScreenshot, false);
    assert.equal(obs.screenshotBase64, undefined);
    assert.equal(obs.accessibility.source, "unknown");
    assert.equal(obs.accessibility.nodeCount, 0);

    const events = service.listOperatorEvents();
    const observeEv = events.find((e) => e.kind === "observe");
    assert.ok(observeEv);
    assert.equal(observeEv.success, true);
    const blob = JSON.stringify(events);
    assert.doesNotMatch(blob, /screenshot/i);
    assert.doesNotMatch(blob, /Fake Desktop/);
  });

  it("records metadata-only pair/status/fs/exec/fail-closed/cleanup events", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-log",
      flockId: FLOCK,
    });
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, {
      birdId: "bird-log",
      flockId: FLOCK,
    });
    const auth = { kind: "capability" as const, token: paired.token };
    await service.status(auth, computer.id);
    await service.filesystem(auth, computer.id, {
      operation: "write",
      path: "/home/flok/log.txt",
      content: "secret-file-bytes",
    });
    await service.exec(auth, computer.id, { argv: ["echo", "secret-stdout"] });
    const act = await service.act(auth, computer.id, {
      actions: [{ type: "click_element", elementId: "nope" }],
    });
    assert.equal(act.results[0]?.success, false);

    const destroyed = await service.destroyThisComputer(computer.id, {
      confirm: true,
      providerRef: computer.providerRef ?? "",
    });
    assert.equal(destroyed.state, "deleted");

    const events = service.listOperatorEvents();
    const kinds = new Set(events.map((e) => e.kind));
    assert.ok(kinds.has("pair"));
    assert.ok(kinds.has("status"));
    assert.ok(kinds.has("file"));
    assert.ok(kinds.has("exec"));
    assert.ok(kinds.has("fail-closed"));
    assert.ok(kinds.has("cleanup"));
    const blob = JSON.stringify(events);
    assert.equal(blob.includes(paired.token), false);
    assert.equal(blob.includes("secret-file-bytes"), false);
    assert.equal(blob.includes("secret-stdout"), false);
  });

  it("destroy refuses missing confirm or mismatched providerRef and does not destroy", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-keep",
      flockId: FLOCK,
    });
    const ref = computer.providerRef;
    assert.ok(ref);

    await assert.rejects(
      () =>
        service.destroyThisComputer(computer.id, {
          confirm: false,
          providerRef: ref,
        }),
      (err: unknown) =>
        err instanceof ComputerError && err.code === "DESTROY_CONFIRM_REQUIRED",
    );
    await assert.rejects(
      () =>
        service.destroyThisComputer(computer.id, {
          confirm: true,
          providerRef: "dbx_WRONG",
        }),
      (err: unknown) =>
        err instanceof ComputerError && err.code === "DESTROY_PROVIDER_REF_MISMATCH",
    );
    const still = await service.get(computer.id);
    assert.notEqual(still.state, "deleted");
    assert.equal(still.providerRef, ref);
  });

  it("serializes concurrent destroy so provider.destroy runs once", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-once",
      flockId: FLOCK,
    });
    const ref = computer.providerRef;
    assert.ok(ref);
    let destroys = 0;
    const orig = provider.destroy.bind(provider);
    provider.destroy = async (providerRef: string) => {
      destroys += 1;
      await orig(providerRef);
    };
    const [a, b] = await Promise.all([
      service.destroyThisComputer(computer.id, { confirm: true, providerRef: ref }),
      service.destroyThisComputer(computer.id, { confirm: true, providerRef: ref }),
    ]);
    assert.equal(a.state, "deleted");
    assert.equal(b.state, "deleted");
    assert.equal(destroys, 1);
  });

  it("buildOperatorComputerView uses plain-language pair/lifecycle labels", () => {
    const view = buildOperatorComputerView(
      {
        id: "c1",
        birdId: "bird-x",
        flockId: FLOCK,
        provider: "runloop",
        providerRef: "dbx_REDACTED_TEST",
        state: "running",
        osType: "linux",
        computerClass: null,
        cpu: null,
        memoryMb: null,
        diskGb: null,
        baseImageVersion: null,
        workspaceRevision: 0,
        lastActiveAt: new Date("2026-08-26T00:00:00.000Z"),
        createdAt: new Date("2026-08-26T00:00:00.000Z"),
        updatedAt: new Date("2026-08-26T00:00:00.000Z"),
        latestCheckpoint: null,
        recoveryNote: null,
      },
      {
        pairStatus: "paired",
        scopes: ["status", "observe"],
        capabilityExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
        lastAction: "observe",
        durableStore: true,
      },
    );
    assert.equal(view.headline, "This bot has this computer");
    assert.equal(view.lifecycleLabel, "running");
    assert.ok(view.warnings.some((w) => /click_element/i.test(w)));
    assert.equal(view.cost.metered, false);
  });

  it("summarizeAccessibility reads CDP source and node count without storing the tree", () => {
    const cdp = summarizeAccessibility({
      source: "cdp",
      nodes: [
        { id: "root", role: "RootWebArea", name: "FLOKS C3B fixture" },
        { id: "n2", role: "button" },
      ],
    });
    assert.equal(cdp.source, "cdp");
    assert.equal(cdp.nodeCount, 2);
    assert.equal(cdp.rootRole, "RootWebArea");
    assert.equal(cdp.rootName, "FLOKS C3B fixture");
    const fake = summarizeAccessibility({ nodes: 0 });
    assert.equal(fake.source, "unknown");
    assert.equal(fake.nodeCount, 0);
  });
});
