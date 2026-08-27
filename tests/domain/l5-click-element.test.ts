/**
 * L5 click_element rewrite. Unpaid. FakeProvider. No live Runloop.
 * Fake AX is protocol coverage only — not Agent Computer proof.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ComputerService,
  FakeProvider,
  capabilityAuth,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";
import {
  AX_CACHE_TTL_MS,
  axCacheFromObservation,
  integerClickTarget,
  rewriteClickElement,
} from "../../src/lib/computers/click-element.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const button = {
  id: "fake-submit",
  role: "button",
  name: "Submit",
  bounds: { x: 100, y: 80, width: 80, height: 24 },
};

describe("L5 click_element", () => {
  it("PHASES marks L5 as owner-requested work; eight tools; Fake is not live proof", () => {
    const phases = readFileSync(join(root, "PHASES.md"), "utf8");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.match(phases, /### PHASE L5[\s\S]*?\*\*Status:\*\* OPEN/);
    assert.match(agents, /L5 — Safer browser control/);
    assert.doesNotMatch(agents, /FakeProvider is product proof/);
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("maps integer bounds to an on-screen center and fail-closes offscreen/unmapped", () => {
    const target = integerClickTarget(button.bounds);
    assert.deepEqual(target, { x: 140, y: 92 });
    const cache = axCacheFromObservation(
      {
        screenWidth: 1280,
        screenHeight: 720,
        accessibilitySummary: { nodes: [button] },
      },
      1_000,
    );
    assert.ok(cache);
    const ok = rewriteClickElement({ type: "click_element", elementId: "fake-submit" }, cache, 1_000);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.action.type, "click_coordinates");
      assert.equal(ok.action.x, 140);
      assert.equal(ok.action.y, 92);
      assert.equal(ok.action.elementId, undefined);
    }
    const stale = rewriteClickElement(
      { type: "click_element", elementId: "fake-submit" },
      cache,
      1_000 + AX_CACHE_TTL_MS + 1,
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "ELEMENT_STALE");
    const unknown = rewriteClickElement({ type: "click_element", elementId: "missing" }, cache, 1_000);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.code, "CLICK_ELEMENT_UNMAPPED");
    const off = axCacheFromObservation(
      {
        screenWidth: 1280,
        screenHeight: 720,
        accessibilitySummary: {
          nodes: [{ id: "off", role: "button", bounds: { x: 1270, y: 10, width: 40, height: 10 } }],
        },
      },
      1_000,
    );
    const offClick = rewriteClickElement({ type: "click_element", elementId: "off" }, off, 1_000);
    assert.equal(offClick.ok, false);
    if (!offClick.ok) assert.equal(offClick.code, "CLICK_OFFSCREEN");
    const noBox = axCacheFromObservation(
      {
        screenWidth: 1280,
        screenHeight: 720,
        accessibilitySummary: { nodes: [{ id: "nobounds", role: "button", name: "X" }] },
      },
      1_000,
    );
    const guessed = rewriteClickElement({ type: "click_element", elementId: "nobounds" }, noBox, 1_000);
    assert.equal(guessed.ok, false);
    if (!guessed.ok) assert.equal(guessed.code, "CLICK_ELEMENT_UNMAPPED");
  });

  it("ComputerService rewrites click_element after observe AX and never forwards elementId", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const computer = await service.requestComputer({ birdId: "bird-l5", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-l5", flockId: "flock-a" });
    const auth = capabilityAuth(cap.token);
    const before = await service.act(auth, computer.id, {
      actions: [{ type: "click_element", elementId: "fake-submit" }],
    });
    assert.equal(before.ok, false);
    assert.match(String(before.results[0]?.error), /fresh AX/i);

    await service.act(auth, computer.id, { actions: [{ type: "open_url", url: "https://l5.example/" }] });
    const obs = await service.observe(auth, computer.id, { includeAccessibility: true });
    const summary = obs.accessibilitySummary as { source?: string; nodes: Array<{ id: string }> };
    assert.notEqual(summary.source, "cdp");
    assert.equal(summary.nodes[0]?.id, "fake-submit");

    const clicked = await service.act(auth, computer.id, {
      actions: [{ type: "click_element", elementId: "fake-submit" }],
    });
    assert.equal(clicked.ok, true);
    assert.equal(clicked.results[0]?.success, true);
    assert.equal(clicked.results[0]?.action.type, "click_coordinates");
    assert.equal(clicked.results[0]?.action.x, 140);
    assert.equal(clicked.results[0]?.action.y, 92);
    assert.equal(clicked.results[0]?.action.elementId, undefined);

    const mixed = await service.act(auth, computer.id, {
      actions: [
        { type: "open_url", url: "https://l5-mixed.example/" },
        { type: "click_element", elementId: "missing" },
        { type: "wait", durationMs: 10 },
      ],
    });
    assert.equal(mixed.ok, false);
    assert.equal(mixed.results.length, 3);
    assert.equal(mixed.results[0]?.success, true);
    assert.equal(mixed.results[0]?.action.type, "open_url");
    assert.equal(mixed.results[1]?.success, false);
    assert.equal(mixed.results[1]?.action.type, "click_element");
    assert.match(String(mixed.results[1]?.error), /not in the last AX tree/i);
    assert.equal(mixed.results[2]?.success, true);
    assert.equal(mixed.results[2]?.action.type, "wait");
  });

  it("does not treat FakeProvider as live CDP proof", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const computer = await service.requestComputer({ birdId: "bird-l5b", flockId: "flock-a" });
    const pair = await service.issuePairCode(computer.id);
    const cap = await service.pair(pair.code, { birdId: "bird-l5b", flockId: "flock-a" });
    await service.act(capabilityAuth(cap.token), computer.id, {
      actions: [{ type: "open_url", url: "https://l5.example/" }],
    });
    const obs = await service.observe(capabilityAuth(cap.token), computer.id, {
      includeAccessibility: true,
    });
    const summary = obs.accessibilitySummary as { source?: string };
    assert.notEqual(summary.source, "cdp");
  });
});
