/**
 * C7 PR2: Fake observe/act stay honest.
 * Safety/routing/isolation only — no fake AX, no fake clicking.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerService,
  FakeProvider,
  capabilityAuth,
} from "../../src/lib/computers/index.js";

const FLOCK = "flock-c7-pr2";

function assertNoActionableAx(summary: unknown): void {
  if (summary === undefined) return;
  const blob = JSON.stringify(summary);
  assert.equal(blob.includes("\"role\""), false);
  assert.equal(blob.includes("\"bounds\""), false);
  assert.equal(blob.includes("\"elementId\""), false);
  assert.equal(blob.includes("\"label\""), false);
  if (summary && typeof summary === "object" && "nodes" in summary) {
    const nodes = (summary as { nodes: unknown }).nodes;
    if (Array.isArray(nodes)) {
      assert.equal(nodes.length, 0);
    } else {
      assert.equal(nodes, 0);
    }
  }
}

describe("C7 Fake observe/act fail-closed", () => {
  let provider: FakeProvider;
  let service: ComputerService;

  beforeEach(() => {
    provider = new FakeProvider();
    service = new ComputerService(provider);
  });

  async function provisionAndPair(birdId: string) {
    const computer = await service.requestComputer({ birdId, flockId: FLOCK });
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, { birdId, flockId: FLOCK });
    return { computer, auth: capabilityAuth(paired.token) };
  }

  it("returns fail-closed click_element without pretending Chrome ran", async () => {
    const { computer, auth } = await provisionAndPair("bird-ax");
    const clicked = await service.act(auth, computer.id, {
      actions: [{ type: "click_element", elementId: "Submit" }],
    });
    assert.equal(clicked.ok, false);
    assert.equal(clicked.results.length, 1);
    assert.equal(clicked.results[0]?.success, false);
    assert.match(String(clicked.results[0]?.error), /click_element/i);
    assert.match(String(clicked.results[0]?.error), /unsupported/i);
  });

  it("keeps open_url markers isolated and still fail-closes click_element in a mixed batch", async () => {
    const noema = await provisionAndPair("bird-noema");
    const code = await provisionAndPair("bird-code");
    const research = await provisionAndPair("bird-research");

    const mixed = await service.act(noema.auth, noema.computer.id, {
      actions: [
        { type: "open_url", url: "https://noema.example/" },
        { type: "click_element", elementId: "ghost" },
      ],
    });
    assert.equal(mixed.ok, false);
    assert.equal(mixed.results[0]?.success, true);
    assert.equal(mixed.results[1]?.success, false);

    await service.act(code.auth, code.computer.id, {
      actions: [{ type: "open_url", url: "https://code.example/" }],
    });

    const markerNoema = await service.filesystem(noema.auth, noema.computer.id, {
      operation: "read",
      path: "/home/flok/.browser/profile/c7-marker",
    });
    const markerCode = await service.filesystem(code.auth, code.computer.id, {
      operation: "read",
      path: "/home/flok/.browser/profile/c7-marker",
    });
    const markerResearch = await service.filesystem(
      research.auth,
      research.computer.id,
      { operation: "read", path: "/home/flok/.browser/profile/c7-marker" },
    );
    assert.equal(markerNoema.ok, true);
    assert.equal(markerNoema.data, "https://noema.example/");
    assert.equal(markerCode.ok, true);
    assert.equal(markerCode.data, "https://code.example/");
    assert.equal(markerResearch.ok, false);

    const obsNoema = await service.observe(noema.auth, noema.computer.id, {});
    const obsResearch = await service.observe(research.auth, research.computer.id, {});
    assert.equal(obsNoema.activeWindow, "https://noema.example/");
    assert.equal(obsResearch.activeWindow, "Fake Desktop");
    assertNoActionableAx(obsNoema.accessibilitySummary);
    assertNoActionableAx(obsResearch.accessibilitySummary);
  });

  it("does not fabricate actionable accessibility on observe", async () => {
    const { computer, auth } = await provisionAndPair("bird-observe");
    await service.act(auth, computer.id, {
      actions: [{ type: "open_url", url: "https://example.test/" }],
    });
    const obs = await service.observe(auth, computer.id, {
      includeAccessibility: true,
    });
    assertNoActionableAx(obs.accessibilitySummary);
  });

  it("fail-closes open_url without a url", async () => {
    const { computer, auth } = await provisionAndPair("bird-nourl");
    const opened = await service.act(auth, computer.id, {
      actions: [{ type: "open_url" }],
    });
    assert.equal(opened.ok, false);
    assert.equal(opened.results[0]?.success, false);
    assert.match(String(opened.results[0]?.error), /open_url requires url/);
    const marker = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/home/flok/.browser/profile/c7-marker",
    });
    assert.equal(marker.ok, false);
  });

  it("fail-closes open_url with an empty url", async () => {
    const { computer, auth } = await provisionAndPair("bird-emptyurl");
    const opened = await service.act(auth, computer.id, {
      actions: [{ type: "open_url", url: "" }],
    });
    assert.equal(opened.ok, false);
    assert.equal(opened.results[0]?.success, false);
    assert.match(String(opened.results[0]?.error), /open_url requires url/);
  });

  it("returns ok false for a mixed batch with invalid open_url", async () => {
    const { computer, auth } = await provisionAndPair("bird-mixed-open");
    const mixed = await service.act(auth, computer.id, {
      actions: [
        { type: "open_url", url: "" },
        { type: "wait", durationMs: 10 },
      ],
    });
    assert.equal(mixed.ok, false);
    assert.equal(mixed.results[0]?.success, false);
    assert.match(String(mixed.results[0]?.error), /open_url requires url/);
    const marker = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/home/flok/.browser/profile/c7-marker",
    });
    assert.equal(marker.ok, false);
  });
});
