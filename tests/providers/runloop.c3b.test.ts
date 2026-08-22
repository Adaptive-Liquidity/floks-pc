/**
 * C3B unpaid tests. Zero Runloop network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerUseNotAvailable,
  MemoryRunloopControlPlane,
  RunloopProvider,
  FLAGS,
  assertNexusDisabled,
} from "../../src/lib/computers/index.js";
import {
  validateAction,
  pngDimensions,
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
  BROWSER_PROFILE_DIR,
} from "../../src/lib/computers/providers/runloop-interactive.js";

function provider(): RunloopProvider {
  return new RunloopProvider({
    client: new MemoryRunloopControlPlane(),
    blueprint: "memory-linux-vm",
  });
}

describe("C3B action validation", () => {
  it("rejects click_element", () => {
    const err = validateAction({ type: "click_element", elementId: "x" });
    assert.ok(err);
    assert.match(err, /unsupported/);
  });

  it("rejects out-of-bounds and non-integer coordinates", () => {
    assert.ok(validateAction({ type: "click_coordinates", x: -1, y: 0 }));
    assert.ok(validateAction({ type: "click_coordinates", x: DISPLAY_WIDTH, y: 0 }));
    assert.ok(validateAction({ type: "click_coordinates", x: 1.5, y: 2 }));
    assert.equal(validateAction({ type: "click_coordinates", x: 200, y: 200 }), null);
  });

  it("rejects malformed, non-http, and jail-escaping file URLs", () => {
    assert.ok(validateAction({ type: "open_url", url: "not a url" }));
    assert.ok(validateAction({ type: "open_url", url: "javascript:alert(1)" }));
    assert.ok(validateAction({ type: "open_url", url: "file:///etc/passwd" }));
    assert.ok(validateAction({ type: "open_url", url: "file:///home/user/flok/../etc/passwd" }));
    assert.equal(validateAction({ type: "open_url", url: "https://example.com" }), null);
    assert.equal(
      validateAction({ type: "open_url", url: "file:///home/user/flok/.flok/fixture.html" }),
      null,
    );
  });

  it("rejects applications outside the allowlist", () => {
    assert.ok(validateAction({ type: "launch_application", application: "bash" }));
    assert.equal(validateAction({ type: "launch_application", application: "browser" }), null);
  });

  it("rejects disallowed keys and bounds type/wait", () => {
    assert.ok(validateAction({ type: "key", key: "; rm -rf /" }));
    assert.ok(validateAction({ type: "key", key: "$(reboot)" }));
    assert.ok(validateAction({ type: "type", text: "x".repeat(2001) }));
    assert.ok(validateAction({ type: "wait", durationMs: 99_000 }));
    assert.ok(validateAction({ type: "wait", durationMs: 0 }));
    assert.ok(validateAction({ type: "scroll" }));
    assert.equal(validateAction({ type: "type", text: "hello" }), null);
    assert.equal(validateAction({ type: "key", key: "Return" }), null);
  });
});

describe("C3B pngDimensions", () => {
  it("reads IHDR from a real 1x1 PNG and rejects garbage", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    assert.deepEqual(pngDimensions(png), { width: 1, height: 1 });
    assert.equal(pngDimensions(Buffer.from("not-png")), null);
  });
});

describe("C3B RunloopProvider (memory)", () => {
  it("hard-locks Nexus", () => {
    assert.equal(FLAGS.FLOK_NEXUS_IQ_ENABLED, false);
    assertNexusDisabled();
  });

  it("advertises computerUse true and vnc false", () => {
    const caps = provider().capabilities();
    assert.equal(caps.computerUse, true);
    assert.equal(caps.vnc, false);
    assert.equal(caps.accessibility, false);
    assert.equal(caps.pauseMemory, false);
  });

  it("ensureInteractiveStack is idempotent", async () => {
    const plane = new MemoryRunloopControlPlane();
    const p = new RunloopProvider({ client: plane, blueprint: "memory" });
    const a = await p.provision({ birdId: "idemp", flockId: "f" });
    const session = await plane.get(a.providerRef);
    const first = (session as unknown as { stackStarts: number }).stackStarts;
    await session.ensureInteractiveStack();
    await session.ensureInteractiveStack();
    const second = (session as unknown as { stackStarts: number }).stackStarts;
    assert.equal(first, 1);
    assert.equal(second, 1);
  });

  it("resume recreates the graphical stack", async () => {
    const plane = new MemoryRunloopControlPlane();
    const p = new RunloopProvider({ client: plane, blueprint: "memory" });
    const a = await p.provision({ birdId: "resume-ui", flockId: "f" });
    const session = await plane.get(a.providerRef);
    assert.equal((session as unknown as { stackStarts: number }).stackStarts, 1);
    await p.pause(a.providerRef);
    await p.wake(a.providerRef);
    assert.equal((session as unknown as { stackStarts: number }).stackStarts, 2);
  });

  it("observe screenshot shape without fabricating accessibility", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "obs", flockId: "f" });
    const obs = await p.observe(a.providerRef, { includeScreenshot: true });
    assert.equal(obs.screenWidth, DISPLAY_WIDTH);
    assert.equal(obs.screenHeight, DISPLAY_HEIGHT);
    assert.ok(obs.screenshotBase64);
    assert.equal(obs.accessibilitySummary, undefined);
    await assert.rejects(
      () => p.observe(a.providerRef, { includeAccessibility: true }),
      (err: unknown) => err instanceof ComputerUseNotAvailable,
    );
  });

  it("act applies bounded actions and fails closed on click_element", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "act", flockId: "f" });
    const good = await p.act(a.providerRef, {
      actions: [
        { type: "open_url", url: "https://example.com/" },
        { type: "click_coordinates", x: 200, y: 200 },
        { type: "type", text: "hi" },
        { type: "key", key: "Return" },
        { type: "scroll", y: 3 },
        { type: "wait", durationMs: 50 },
      ],
    });
    assert.equal(good.ok, true);
    assert.equal(good.results.length, 6);
    const bad = await p.act(a.providerRef, {
      actions: [{ type: "click_element", elementId: "nope" }],
    });
    assert.equal(bad.ok, false);
    assert.match(bad.results[0]?.error ?? "", /unsupported/);
  });

  it("does not shell-inject via type text", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "inj", flockId: "f" });
    const r = await p.act(a.providerRef, {
      actions: [{ type: "type", text: "$(reboot); rm -rf /" }],
    });
    assert.equal(r.ok, true);
  });

  it("browser profile lives under the workspace jail", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "prof", flockId: "f" });
    await p.act(a.providerRef, {
      actions: [{ type: "open_url", url: "https://example.com/" }],
    });
    const marker = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${BROWSER_PROFILE_DIR}/last-url`,
    });
    assert.equal(marker.ok, true);
    assert.equal(marker.data, "https://example.com/");
  });

  it("two Devboxes do not share browser profiles", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "pa", flockId: "f" });
    const b = await p.provision({ birdId: "pb", flockId: "f" });
    await p.act(a.providerRef, {
      actions: [{ type: "open_url", url: "https://a.example/" }],
    });
    const fromB = await p.filesystem(b.providerRef, {
      operation: "read",
      path: `${BROWSER_PROFILE_DIR}/last-url`,
    });
    assert.equal(fromB.ok, false);
  });

  it("profile survives suspend/resume (disk, not process)", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "persist", flockId: "f" });
    await p.act(a.providerRef, {
      actions: [{ type: "open_url", url: "https://keep.example/" }],
    });
    await p.pause(a.providerRef);
    await p.wake(a.providerRef);
    const kept = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${BROWSER_PROFILE_DIR}/last-url`,
    });
    assert.equal(kept.ok, true);
    assert.equal(kept.data, "https://keep.example/");
  });

  it("takeover remains fail-closed; vnc capability false", async () => {
    const p = provider();
    assert.equal(p.capabilities().vnc, false);
    const a = await p.provision({ birdId: "vnc", flockId: "f" });
    await assert.rejects(() => p.takeover(a.providerRef));
  });
});
