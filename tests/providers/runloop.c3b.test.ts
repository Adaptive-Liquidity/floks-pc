/**
 * C3B unpaid tests. Zero Runloop network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  classifyBlueprintBuildStatus,
  chromeLaunchArgv,
  argvAsUiUser,
  ENSURE_INTERACTIVE_SH,
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
  BROWSER_PROFILE_DIR,
  OBS_SHOT_DIR,
  uniqueObsShotPath,
  FLOK_UI_USER,
  FLOK_UI_UID,
  CHROME_LOG_PATH,
  CHROME_HOME_FALLBACK_DIR,
  CHROME_READY_TIMEOUT_MS,
  CHROME_READY_POLL_MS,
  CHROME_READY_PROBE_PY,
  chromeHasNoSandbox,
  chromeHasDisableSetuidSandbox,
  chromeHasUserDataDir,
  chromeProfileHasBrowserState,
  chromeSandboxDisabled,
  classifyChromeReadiness,
  formatChromeReadyFailure,
  parseChromeReadyEvidence,
  pollUntilChromeReady,
  sanitizeChromeLog,
  type ChromeReadyEvidence,
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
    assert.ok(validateAction({ type: "scroll", x: 5 }));
    assert.ok(validateAction({ type: "scroll", y: 0 }));
    assert.ok(validateAction({ type: "scroll", x: 1, y: 3 }));
    assert.match(validateAction({ type: "scroll", x: 5 }) ?? "", /horizontal/);
    assert.equal(validateAction({ type: "scroll", y: 3 }), null);
    assert.equal(validateAction({ type: "scroll", y: -2 }), null);
    assert.equal(validateAction({ type: "scroll", x: 0, y: 3 }), null);
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

describe("C3B blueprint build status", () => {
  it("polls queued/provisioning/building and terminals on complete or failed", () => {
    assert.equal(classifyBlueprintBuildStatus("queued"), "pending");
    assert.equal(classifyBlueprintBuildStatus("provisioning"), "pending");
    assert.equal(classifyBlueprintBuildStatus("building"), "pending");
    assert.equal(classifyBlueprintBuildStatus("build_complete"), "success");
    assert.equal(classifyBlueprintBuildStatus("failed"), "failure");
    assert.equal(classifyBlueprintBuildStatus("build_failed"), "failure");
    assert.equal(classifyBlueprintBuildStatus("mystery"), "failure");
  });
});

describe("C3B graphical user isolation", () => {
  it("drops Chrome and input to flok-ui without --no-sandbox", () => {
    assert.equal(FLOK_UI_USER, "flok-ui");
    assert.equal(FLOK_UI_UID, 1500);
    const chrome = chromeLaunchArgv("https://example.com/");
    assert.equal(chrome[0], "runuser");
    assert.equal(chrome[2], "flok-ui");
    assert.equal(chrome.includes("--no-sandbox"), false);
    assert.equal(chrome.includes("--disable-setuid-sandbox"), false);
    assert.ok(chrome.some((a) => a.startsWith("--user-data-dir=")));
    const click = argvAsUiUser(["xdotool", "click", "1"]);
    assert.deepEqual(click.slice(0, 3), ["runuser", "-u", "flok-ui"]);
  });
});

describe("C3B Dockerfile and ensure contract", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "../..");
  const dockerfile = readFileSync(
    join(root, "blueprints/runloop-interactive/Dockerfile"),
    "utf8",
  );
  const ensureFile = readFileSync(
    join(root, "blueprints/runloop-interactive/ensure-interactive.sh"),
    "utf8",
  );

  it("extends the documented DnD Ubuntu base and stays root", () => {
    assert.match(dockerfile, /^FROM runloop:runloop\/universal-ubuntu-24.04-x86_64-dnd$/m);
    assert.equal(/^USER\s/m.test(dockerfile), false);
    assert.match(dockerfile, /useradd -m -u 1500/);
    assert.match(dockerfile, /command -v docker/);
    assert.match(dockerfile, /command -v git/);
    assert.match(dockerfile, /command -v python3/);
    assert.match(dockerfile, /command -v node/);
    assert.match(dockerfile, /chmod 4755/);
    assert.match(
      dockerfile,
      /chmod 700 \/home\/user\/flok\/\.browser \/home\/user\/flok\/\.browser\/profile/,
    );
    assert.equal(/^(RUN|CMD|ENTRYPOINT).*(--no-sandbox)/m.test(dockerfile), false);
    assert.match(dockerfile, /chown root:root \/home\/user\/flok\/\.flok/);
    assert.doesNotMatch(dockerfile, /chown -R flok-ui:flok-ui[^\n]*\.flok/);
  });

  it("ensure script is localhost-only, flok-ui only, and restarts X after resume", () => {
    for (const src of [ENSURE_INTERACTIVE_SH, ensureFile]) {
      assert.match(src, /refuse to start Chrome as root/);
      assert.match(src, /x11vnc .* -localhost /);
      assert.match(src, /127\.0\.0\.1:\$\{NOVNC_PORT\}/);
      assert.match(src, /rm -f \/tmp\/\.X11-unix\/X99 \/tmp\/\.X99-lock/);
      assert.match(src, /chmod 700 "\$PROFILE"/);
      assert.match(src, /\/tmp\/flok-chrome\.log/);
      assert.match(src, /test -w "\$PROFILE"/);
      assert.match(src, /chown root:root \/home\/user\/flok\/\.flok/);
      assert.match(src, /chown -R "\$UI_USER:\$UI_USER" \/home\/user\/flok\/\.browser/);
      assert.doesNotMatch(src, /chown -R .* \/home\/user\/flok\/\.browser \/home\/user\/flok\/\.flok/);
      assert.doesNotMatch(src, /--no-sandbox/);
      assert.doesNotMatch(src, /chmod 777/);
      assert.doesNotMatch(src, /--disable-setuid-sandbox/);
    }
  });

  it("ENSURE_INTERACTIVE_SH matches ensure-interactive.sh from set -euo pipefail", () => {
    const body = (src: string): string => {
      const i = src.indexOf("set -euo pipefail");
      assert.ok(i >= 0, "missing set -euo pipefail");
      return src.slice(i).replace(/\s+$/, "");
    };
    assert.equal(body(ENSURE_INTERACTIVE_SH), body(ensureFile));
  });
});

describe("C3B RunloopProvider (memory)", () => {
  it("hard-locks Nexus", () => {
    assert.equal(FLAGS.FLOK_NEXUS_IQ_ENABLED, false);
    assertNexusDisabled();
  });

  it("advertises computerUse true after the paid C3B live gate", () => {
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
    const text = "$(reboot); rm -rf /";
    const argv = argvAsUiUser(["xdotool", "type", "--", text]);
    assert.equal(argv[argv.length - 1], text);
    assert.equal(argv.includes("--"), true);
    assert.equal(argv.filter((a) => a === text).length, 1);
    assert.equal(argv.includes("sh"), false);
    assert.equal(argv.includes("-c"), false);
    assert.equal(argv.includes(`/bin/sh -c ${text}`), false);
    const p = provider();
    const a = await p.provision({ birdId: "inj", flockId: "f" });
    const r = await p.act(a.providerRef, {
      actions: [{ type: "type", text }],
    });
    assert.equal(r.ok, true);
  });

  it("stops the act batch after the first failure and does not send later input", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "batch-stop", flockId: "f" });
    const r = await p.act(a.providerRef, {
      actions: [
        { type: "click_coordinates", x: 10, y: 10 },
        { type: "click_element", elementId: "nope" },
        { type: "type", text: "should-not-run" },
        { type: "key", key: "Return" },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.results.length, 4);
    assert.equal(r.results[0]?.success, true);
    assert.equal(r.results[1]?.success, false);
    assert.match(r.results[1]?.error ?? "", /unsupported/);
    assert.equal(r.results[2]?.success, false);
    assert.equal(r.results[2]?.error, "not executed");
    assert.equal(r.results[3]?.success, false);
    assert.equal(r.results[3]?.error, "not executed");
  });

  it("uniqueObsShotPath is under .browser and unique per call", () => {
    const a = uniqueObsShotPath();
    const b = uniqueObsShotPath();
    assert.notEqual(a, b);
    assert.equal(a.startsWith(`${OBS_SHOT_DIR}/obs-`), true);
    assert.equal(b.startsWith(`${OBS_SHOT_DIR}/obs-`), true);
    assert.equal(a.endsWith(".png"), true);
    assert.equal(a.includes("/.flok/"), false);
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

  it("memory-plane last-url/launched markers are not a real Chrome profile", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "fake-profile", flockId: "f" });
    await p.act(a.providerRef, {
      actions: [
        { type: "open_url", url: "https://example.com/" },
        { type: "launch_application", application: "browser" },
      ],
    });
    const listed = await p.filesystem(a.providerRef, {
      operation: "list",
      path: BROWSER_PROFILE_DIR,
    });
    assert.equal(listed.ok, true);
    assert.ok(Array.isArray(listed.data));
    assert.equal(
      chromeProfileHasBrowserState(listed.data as string[]),
      false,
      "memory-plane last-url/launched must not count as Chrome browser state",
    );
  });
});

const CHROME_CMD =
  "1500 google-chrome-stable --user-data-dir=/home/user/flok/.browser/profile --window-size=1440,900 --app=file:///home/user/flok/.flok/fixture.html";

function evidence(over: Partial<ChromeReadyEvidence> = {}): ChromeReadyEvidence {
  return {
    chromeCmdlines: [],
    profileEntries: [],
    profileEntriesUi: [],
    profileUid: 1500,
    profileGid: 1500,
    profileMode: "700",
    profileWritableByUi: true,
    browserDirMode: "700",
    workspaceMode: "775",
    sandboxPath: "/opt/google/chrome/chrome-sandbox",
    sandboxMode: "4755",
    sandboxNosuid: false,
    xvfbAlive: true,
    openboxAlive: true,
    display: ":99",
    visibleWindows: [],
    homeFallbackEntries: [],
    chromeLogTail: "",
    logHasSandboxError: false,
    logHasChromeOutput: false,
    unprivilegedUserns: "1",
    ...over,
  };
}

describe("C3B Chrome readiness classification", () => {
  it("is ready when flok-ui Chrome has user-data-dir and real profile state", () => {
    const result = classifyChromeReadiness(
      evidence({
        chromeCmdlines: [CHROME_CMD],
        profileEntries: ["Default", "Local State"],
      }),
    );
    assert.equal(result.status, "ready");
    assert.equal(result.ready, true);
    assert.equal(result.terminal, true);
  });

  it("is ready when a Chrome window is visible even before profile flush", () => {
    const result = classifyChromeReadiness(
      evidence({
        chromeCmdlines: [CHROME_CMD],
        visibleWindows: ["chrome"],
      }),
    );
    assert.equal(result.status, "ready");
    assert.equal(result.ready, true);
    const live = classifyChromeReadiness(
      evidence({
        chromeCmdlines: [CHROME_CMD],
        visibleWindows: ["chrome"],
      }),
      { requireProfile: true },
    );
    assert.equal(live.status, "pending");
    assert.equal(live.ready, false);
  });

  it("treats an empty profile as not ready", () => {
    const pending = classifyChromeReadiness(evidence({ chromeCmdlines: [CHROME_CMD] }));
    assert.equal(pending.status, "pending");
    assert.equal(pending.ready, false);
    assert.equal(pending.terminal, false);
    const timed = classifyChromeReadiness(evidence({ chromeCmdlines: [CHROME_CMD] }), {
      timedOut: true,
    });
    assert.equal(timed.status, "readiness_timeout");
    assert.equal(timed.ready, false);
    assert.equal(timed.terminal, true);
  });

  it("does not treat memory-plane test markers as Chrome browser state", () => {
    assert.equal(chromeProfileHasBrowserState(["last-url"]), false);
    assert.equal(chromeProfileHasBrowserState(["launched"]), false);
    assert.equal(chromeProfileHasBrowserState(["c3b-marker"]), false);
    assert.equal(chromeProfileHasBrowserState([".pki"]), false);
    assert.equal(chromeProfileHasBrowserState(["Default"]), true);
    assert.equal(chromeProfileHasBrowserState(["Local State"]), true);
    const result = classifyChromeReadiness(
      evidence({
        chromeCmdlines: [CHROME_CMD],
        profileEntries: ["last-url", "c3b-marker", "launched"],
      }),
    );
    assert.equal(result.status, "pending");
    assert.equal(result.ready, false);
  });

  it("classifies never_started and started_then_exited on timeout", () => {
    const never = classifyChromeReadiness(evidence(), { timedOut: true });
    assert.equal(never.status, "never_started");
    const exited = classifyChromeReadiness(
      evidence({ logHasChromeOutput: true, chromeLogTail: "chrome failed" }),
      { timedOut: true },
    );
    assert.equal(exited.status, "started_then_exited");
  });

  it("refuses --no-sandbox and --disable-setuid-sandbox immediately", () => {
    const noSandbox = classifyChromeReadiness(
      evidence({
        chromeCmdlines: [`${CHROME_CMD} --no-sandbox`],
        profileEntries: ["Default"],
      }),
    );
    assert.equal(noSandbox.status, "sandbox_disabled");
    assert.equal(noSandbox.ready, false);
    assert.equal(noSandbox.terminal, true);
    const disableSetuid = classifyChromeReadiness(
      evidence({ chromeCmdlines: [`${CHROME_CMD} --disable-setuid-sandbox`] }),
    );
    assert.equal(disableSetuid.status, "sandbox_disabled");
    assert.equal(chromeHasNoSandbox(CHROME_CMD), false);
    assert.equal(chromeHasNoSandbox(`${CHROME_CMD} --no-sandbox`), true);
    assert.equal(chromeHasDisableSetuidSandbox(`${CHROME_CMD} --disable-setuid-sandbox`), true);
    assert.equal(chromeSandboxDisabled(`${CHROME_CMD} --no-sandbox`), true);
  });

  it("classifies permissions_failure when the profile is not writable by flok-ui", () => {
    const result = classifyChromeReadiness(
      evidence({
        chromeCmdlines: [CHROME_CMD],
        profileWritableByUi: false,
        profileUid: 0,
        profileMode: "755",
      }),
    );
    assert.equal(result.status, "permissions_failure");
    assert.equal(result.terminal, true);
    assert.match(result.message, /not writable/);
  });

  it("classifies display_failure when Chrome is alive without Xvfb", () => {
    const result = classifyChromeReadiness(
      evidence({ chromeCmdlines: [CHROME_CMD], xvfbAlive: false }),
    );
    assert.equal(result.status, "display_failure");
    assert.equal(result.terminal, true);
  });

  it("waits on HOME fallback during startup, then classifies profile_redirected", () => {
    const ev = evidence({
      chromeCmdlines: [CHROME_CMD],
      homeFallbackEntries: ["Default"],
    });
    const pending = classifyChromeReadiness(ev);
    assert.equal(pending.status, "pending");
    assert.equal(pending.terminal, false);
    const redirected = classifyChromeReadiness(ev, { timedOut: true });
    assert.equal(redirected.status, "profile_redirected");
    assert.match(redirected.message, new RegExp(CHROME_HOME_FALLBACK_DIR));
  });

  it("classifies sandbox_failure from startup log only after timeout", () => {
    const ev = evidence({
      chromeCmdlines: [CHROME_CMD],
      logHasSandboxError: true,
      logHasChromeOutput: true,
      chromeLogTail: "The SUID sandbox helper binary was found, but is not configured correctly",
    });
    const pending = classifyChromeReadiness(ev);
    assert.equal(pending.status, "pending");
    const failed = classifyChromeReadiness(ev, { timedOut: true });
    assert.equal(failed.status, "sandbox_failure");
  });

  it("becomes ready on the third probe via pollUntilChromeReady", async () => {
    let n = 0;
    let now = 0;
    const { result, evidence: ev } = await pollUntilChromeReady(
      async () => {
        n += 1;
        if (n < 3) {
          return evidence({ chromeCmdlines: [CHROME_CMD], visibleWindows: ["chrome"] });
        }
        return evidence({
          chromeCmdlines: [CHROME_CMD],
          profileEntries: ["Default"],
        });
      },
      {
        timeoutMs: 10_000,
        intervalMs: 100,
        requireProfile: true,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    );
    assert.equal(result.status, "ready");
    assert.equal(n, 3);
    assert.deepEqual(ev.profileEntries, ["Default"]);
  });

  it("pollUntilChromeReady terminals on classified failure without waiting out the clock", async () => {
    let n = 0;
    const { result } = await pollUntilChromeReady(
      async () => {
        n += 1;
        return evidence({
          chromeCmdlines: [`${CHROME_CMD} --no-sandbox`],
        });
      },
      {
        timeoutMs: 20_000,
        intervalMs: 500,
        now: () => 0,
        sleep: async () => {
          throw new Error("should not sleep after sandbox_disabled");
        },
      },
    );
    assert.equal(result.status, "sandbox_disabled");
    assert.equal(n, 1);
  });

  it("sanitizes Chrome logs and formats classified failures", () => {
    const raw = sanitizeChromeLog("ok\nAuthorization: Bearer secret\napi_key=abc\nchrome started");
    assert.doesNotMatch(raw, /Bearer secret/);
    assert.doesNotMatch(raw, /api_key=abc/);
    assert.match(raw, /chrome started/);
    const failure = formatChromeReadyFailure(
      {
        status: "permissions_failure",
        ready: false,
        terminal: true,
        message: "profile not writable by flok-ui",
      },
      evidence({ profileMode: "755", profileUid: 0, profileWritableByUi: false }),
    );
    assert.match(failure, /permissions_failure/);
    assert.match(failure, /profile mode=755 uid=0/);
    assert.doesNotMatch(failure, /RUNLOOP_API_KEY/);
  });

  it("parses probe JSON and keeps CHROME_READY_PROBE_PY guest-local", () => {
    const parsed = parseChromeReadyEvidence(
      JSON.stringify(
        evidence({
          chromeCmdlines: [CHROME_CMD],
          profileEntries: ["Default"],
          chromeLogTail: "api_key=should-strip\nready",
        }),
      ),
    );
    assert.equal(parsed.profileEntries[0], "Default");
    assert.equal(chromeHasUserDataDir(parsed.chromeCmdlines[0] ?? ""), true);
    assert.doesNotMatch(parsed.chromeLogTail, /api_key/);
    assert.match(CHROME_READY_PROBE_PY, /\/tmp\/flok-chrome\.log/);
    assert.match(CHROME_READY_PROBE_PY, /\/home\/user\/flok\/\.browser\/profile/);
    assert.match(CHROME_READY_PROBE_PY, /flok-ui/);
    assert.match(CHROME_READY_PROBE_PY, /unprivileged_userns_clone/);
    assert.equal(CHROME_LOG_PATH, "/tmp/flok-chrome.log");
    assert.equal(CHROME_READY_TIMEOUT_MS, 20_000);
    assert.equal(CHROME_READY_POLL_MS, 500);
  });
});
