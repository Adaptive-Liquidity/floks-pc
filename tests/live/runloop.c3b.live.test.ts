/**
 * Opt-in C3B live tests. Skipped unless FLOK_LIVE_RUNLOOP_C3B_TEST=1.
 * When the flag is set, missing credentials FAIL (never silent-skip).
 * Always destroy the paid Devbox in finally.
 *
 * Do not run from ordinary verify / PR CI.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { RunloopProvider } from "../../src/lib/computers/providers/index.js";
import {
  BROWSER_PROFILE_DIR,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  FIXTURE_PATH,
} from "../../src/lib/computers/providers/runloop-interactive.js";

const LIVE = process.env.FLOK_LIVE_RUNLOOP_C3B_TEST === "1";

describe("Runloop C3B live interactive Devbox", { skip: !LIVE }, () => {
  before(() => {
    if (!process.env.RUNLOOP_API_KEY) {
      throw new Error("FLOK_LIVE_RUNLOOP_C3B_TEST=1 but RUNLOOP_API_KEY missing");
    }
    if (!process.env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT && !process.env.FLOK_RUNLOOP_BLUEPRINT) {
      throw new Error(
        "FLOK_LIVE_RUNLOOP_C3B_TEST=1 but interactive blueprint is missing (must FAIL, not skip)",
      );
    }
  });

  it("one Devbox: stack, fixture, observe, input, profile, suspend/resume, local noVNC, cleanup", async () => {
    if (process.env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT) {
      process.env.FLOK_RUNLOOP_BLUEPRINT = process.env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT;
    }
    const p = await RunloopProvider.fromEnv();
    const refs: string[] = [];
    try {
      const a = await p.provision({ birdId: "c3b-live", flockId: "flock-live" });
      refs.push(a.providerRef);

      const opened = await p.act(a.providerRef, {
        actions: [
          { type: "open_url", url: `file://${FIXTURE_PATH}` },
          { type: "wait", durationMs: 1500 },
        ],
      });
      assert.equal(opened.ok, true, JSON.stringify(opened.results));

      const obs = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.equal(obs.screenWidth, DISPLAY_WIDTH);
      assert.equal(obs.screenHeight, DISPLAY_HEIGHT);
      assert.ok(obs.screenshotBase64 && obs.screenshotBase64.length > 100);
      assert.equal(obs.accessibilitySummary, undefined);

      const clicks = await p.act(a.providerRef, {
        actions: [
          { type: "click_coordinates", x: 220, y: 180 },
          { type: "type", text: "flok" },
          { type: "key", key: "Return" },
          { type: "scroll", y: 3 },
        ],
      });
      assert.equal(clicks.ok, true, JSON.stringify(clicks.results));

      await p.filesystem(a.providerRef, {
        operation: "write",
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
        content: "profile-disk",
      });

      await p.pause(a.providerRef);
      await p.wake(a.providerRef);

      const kept = await p.filesystem(a.providerRef, {
        operation: "read",
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
      });
      assert.equal(kept.ok, true);
      assert.equal(kept.data, "profile-disk");

      const relaunch = await p.act(a.providerRef, {
        actions: [
          { type: "open_url", url: `file://${FIXTURE_PATH}` },
          { type: "wait", durationMs: 1500 },
        ],
      });
      assert.equal(relaunch.ok, true, JSON.stringify(relaunch.results));

      const after = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.ok(after.screenshotBase64);

      const novnc = await p.exec(a.providerRef, {
        argv: [
          "python3",
          "-c",
          "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6080/', timeout=3); print('ok')",
        ],
      });
      assert.equal(novnc.exitCode, 0, novnc.stderr);
      assert.match(novnc.stdout, /ok/);
    } finally {
      for (const ref of refs) {
        await p.destroy(ref).catch(() => undefined);
      }
    }
  });
});
