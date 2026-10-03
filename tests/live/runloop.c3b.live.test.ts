/**
 * Opt-in C3B live tests. Skipped unless FLOK_LIVE_RUNLOOP_C3B_TEST=1.
 * When the flag is set, missing credentials FAIL (never silent-skip).
 * Always destroy the paid Devbox in finally.
 *
 * open_url navigates the one visible Chrome and checks the loaded URL.
 * The C3B HTML fixture is test-only: this file writes it into the workspace.
 *
 * Do not run from ordinary verify / PR CI.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunloopProvider } from "../../src/lib/computers/providers/index.js";
import type { ExecResult } from "../../src/lib/computers/types.js";
import {
  BROWSER_PROFILE_DIR,
  CHROME_READY_TIMEOUT_MS,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  chromeHasNoSandbox,
  chromeHasUserDataDir,
  chromeSandboxDisabled,
  pngDimensions,
} from "../../src/lib/computers/providers/runloop-interactive.js";
import {
  CONTROL_PLANE_DIR,
  CONTROL_PLANE_EXECVP_PATH,
  FLOK_BOT_UID,
  FLOK_BOT_USER,
} from "../../src/lib/computers/providers/runloop-bot-user.js";

const LIVE = process.env.FLOK_LIVE_RUNLOOP_C3B_TEST === "1";
const FIXTURE_WORKSPACE = "/home/user/flok/c3b-fixture.html";
const FIXTURE_HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/c3b-fixture.html"),
  "utf8",
);

const LISTEN_CHECK = [
  "import pathlib,sys",
  "ports={5900,6080}",
  "v4_loop,v4_any={'0100007F'},{'00000000'}",
  "v6_loop,v6_any={'00000000000000000000000001000000'},{'00000000000000000000000000000000'}",
  "found={p:[] for p in ports}",
  "for path,loop,any_ in (('/proc/net/tcp',v4_loop,v4_any),('/proc/net/tcp6',v6_loop,v6_any)):",
  "    try: lines=pathlib.Path(path).read_text().splitlines()[1:]",
  "    except FileNotFoundError: continue",
  "    for line in lines:",
  "        parts=line.split()",
  "        if parts[3]!='0A': continue",
  "        ip,hp=parts[1].split(':')",
  "        port=int(hp,16)",
  "        if port in ports: found[port].append((path,ip,ip in loop))",
  "bad=[]",
  "for port,addrs in found.items():",
  "    if not addrs: bad.append(f'{port} not listening')",
  "    for path,ip,is_loop in addrs:",
  "        if not is_loop: bad.append(f'{port} bound {path}:{ip}')",
  "print('LISTEN',found)",
  "print('BAD',bad)",
  "sys.exit(1 if bad else 0)",
].join("\n");

async function mustExec(
  p: RunloopProvider,
  ref: string,
  argv: string[],
  stage: string,
): Promise<ExecResult> {
  const r = await p.exec(ref, { argv, timeoutMs: 20_000 });
  assert.equal(r.exitCode, 0, `${stage}: ${argv.join(" ")}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  return r;
}

/**
 * Chrome readiness as the bot user. computer_exec is unprivileged `flok`, so the
 * root-only CHROME_READY_PROBE_PY is not used here. pgrep sees flok-ui Chrome
 * with --user-data-dir. computer_fs must not list or read the profile.
 */
async function awaitChromeReady(p: RunloopProvider, ref: string, stage: string): Promise<void> {
  const deadline = Date.now() + CHROME_READY_TIMEOUT_MS;
  let last = "";
  for (;;) {
    const proc = await p.exec(ref, {
      argv: ["pgrep", "-u", "flok-ui", "-a", "google-chrome"],
      timeoutMs: 10_000,
    });
    const cmdlines = (proc.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.includes("pgrep"));
    last = `exit=${proc.exitCode} cmdlines=${cmdlines.join(" | ") || "(none)"}`;
    const ours = cmdlines.filter((c) => /google-chrome/.test(c) || chromeHasUserDataDir(c));
    if (ours.some(chromeSandboxDisabled) || ours.some(chromeHasNoSandbox)) {
      assert.fail(`${stage}: Chrome sandbox disabled\n${last}`);
    }
    if (ours.some(chromeHasUserDataDir)) {
      return;
    }
    if (Date.now() >= deadline) {
      assert.fail(`${stage}: Chrome not ready via flok-visible pgrep --user-data-dir\n${last}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

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
    const caps = p.capabilities();
    assert.equal(caps.computerUse, true, "computerUse is true after the paid C3B live gate");
    assert.equal(caps.vnc, false);
    assert.equal(caps.accessibility, false);
    assert.equal(caps.pauseMemory, false);

    const refs: string[] = [];
    try {
      const a = await p.provision({ birdId: "c3b-live", flockId: "flock-live" });
      refs.push(a.providerRef);
      assert.ok(a.providerRef, "provision: missing providerRef");

      const who = await mustExec(p, a.providerRef, ["whoami"], "bot whoami");
      assert.equal(who.stdout.trim(), FLOK_BOT_USER, "computer_exec must run as flok, not root");
      const botUid = await mustExec(p, a.providerRef, ["id", "-u"], "bot uid");
      assert.equal(botUid.stdout.trim(), String(FLOK_BOT_UID), "computer_exec uid must be 1501");
      const sudo = await p.exec(a.providerRef, { argv: ["sudo", "-n", "whoami"], timeoutMs: 10_000 });
      assert.notEqual(sudo.exitCode, 0, "passwordless sudo must not be available");
      assert.doesNotMatch(sudo.stdout, /^root$/m);
      const helper = await p.exec(a.providerRef, {
        argv: ["cat", CONTROL_PLANE_EXECVP_PATH],
        timeoutMs: 10_000,
      });
      assert.notEqual(helper.exitCode, 0, "bot must not read /var/lib/flok helpers");
      assert.doesNotMatch(helper.stdout, /import os, sys, json/);
      const helperLs = await p.exec(a.providerRef, {
        argv: ["ls", "-a", CONTROL_PLANE_DIR],
        timeoutMs: 10_000,
      });
      assert.notEqual(helperLs.exitCode, 0, "bot must not list /var/lib/flok");

      const tools = await mustExec(
        p,
        a.providerRef,
        ["bash", "-lc", "command -v docker && command -v git && command -v python3 && command -v node"],
        "tools present",
      );
      assert.match(tools.stdout, /docker/, "tools present: docker missing");
      assert.match(tools.stdout, /git/, "tools present: git missing");
      assert.match(tools.stdout, /python3/, "tools present: python3 missing");
      assert.match(tools.stdout, /node/, "tools present: node missing");

      const ui = await mustExec(p, a.providerRef, ["id", "-u", "flok-ui"], "flok-ui uid");
      assert.equal(ui.stdout.trim(), "1500", "flok-ui uid: expected 1500");

      const chromeVer = await mustExec(
        p,
        a.providerRef,
        ["cat", "/etc/flok-chrome-version"],
        "chrome version",
      );
      assert.match(chromeVer.stdout, /Google Chrome/i, "chrome version: unexpected output");
      console.log("C3B chrome version", chromeVer.stdout.trim());
      console.log("C3B chrome ready timeout ms", CHROME_READY_TIMEOUT_MS);

      const xvfb = await mustExec(p, a.providerRef, ["pgrep", "-u", "flok-ui", "-a", "Xvfb"], "Xvfb :99");
      assert.match(xvfb.stdout, /:99/, "Xvfb :99: display missing from cmdline");
      const openbox = await mustExec(
        p,
        a.providerRef,
        ["pgrep", "-u", "flok-ui", "-a", "openbox"],
        "Openbox",
      );
      assert.match(openbox.stdout, /openbox/i, "Openbox: process missing");

      const firstShot = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.equal(firstShot.coordinateSpace, "screen_pixels");
      assert.equal(firstShot.screenBlank, false, "screenshot after provision is a single colour");
      assert.equal(firstShot.screenWidth, DISPLAY_WIDTH);
      assert.equal(firstShot.screenHeight, DISPLAY_HEIGHT);

      const example = await p.act(a.providerRef, {
        actions: [{ type: "open_url", url: "https://example.com" }],
      });
      assert.equal(example.ok, true, `example.com: ${JSON.stringify(example.results)}`);
      assert.match(example.results[0]?.finalUrl ?? "", /^https:\/\/example\.com\/?$/);
      const exampleObs = await p.observe(a.providerRef, {
        includeScreenshot: true,
        includeAccessibility: true,
      });
      assert.equal(exampleObs.screenBlank, false);
      assert.match(exampleObs.browserUrl ?? "", /example\.com/);
      const axNodes = (exampleObs.accessibilitySummary as { nodes?: Array<{ role?: string; name?: string }> } | undefined)
        ?.nodes;
      const axRoot = axNodes?.find((node) => node.role === "RootWebArea");
      assert.equal(axRoot?.name, "Example Domain");

      const workspaceList = await p.filesystem(a.providerRef, {
        operation: "list",
        path: "/home/user/flok",
      });
      assert.equal(workspaceList.ok, true);
      assert.equal(
        Array.isArray(workspaceList.data) && workspaceList.data.includes(".flok"),
        false,
        "customer workspace must not list leftover control-plane .flok",
      );
      assert.equal(
        Array.isArray(workspaceList.data) && workspaceList.data.includes(".browser"),
        false,
        "customer workspace must not list the flok-ui browser profile",
      );
      const hiddenHelpers = await p.filesystem(a.providerRef, {
        operation: "list",
        path: "/home/user/flok/.flok",
      });
      assert.equal(hiddenHelpers.ok, false, "workspace .flok must not be readable via computer_fs");
      const hiddenProfile = await p.filesystem(a.providerRef, {
        operation: "list",
        path: BROWSER_PROFILE_DIR,
      });
      assert.equal(hiddenProfile.ok, false, "browser profile must not be listable via computer_fs");
      const cookies = await p.filesystem(a.providerRef, {
        operation: "read",
        path: `${BROWSER_PROFILE_DIR}/Cookies`,
      });
      assert.equal(cookies.ok, false, "bot must not read Chrome cookies via computer_fs");
      const cookieExec = await p.exec(a.providerRef, {
        argv: ["cat", `${BROWSER_PROFILE_DIR}/Cookies`],
        timeoutMs: 10_000,
      });
      assert.notEqual(cookieExec.exitCode, 0, "bot must not cat Chrome cookies");

      const wroteFixture = await p.filesystem(a.providerRef, {
        operation: "write",
        path: FIXTURE_WORKSPACE,
        content: FIXTURE_HTML,
      });
      assert.equal(wroteFixture.ok, true, "test-only fixture write failed");

      const opened = await p.act(a.providerRef, {
        actions: [{ type: "open_url", url: `file://${FIXTURE_WORKSPACE}` }],
      });
      assert.equal(opened.ok, true, `open_url fixture: ${JSON.stringify(opened.results)}`);
      assert.match(opened.results[0]?.finalUrl ?? "", /c3b-fixture\.html/);

      await awaitChromeReady(p, a.providerRef, "chrome ready after open_url");

      const profileDenied = await p.filesystem(a.providerRef, {
        operation: "list",
        path: BROWSER_PROFILE_DIR,
      });
      assert.equal(profileDenied.ok, false, "bot computer_fs must not list the Chrome profile");

      const obs = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.equal(obs.screenWidth, DISPLAY_WIDTH, "screenshot: width");
      assert.equal(obs.screenHeight, DISPLAY_HEIGHT, "screenshot: height");
      assert.ok(obs.screenshotBase64 && obs.screenshotBase64.length > 100, "screenshot: missing png");
      assert.equal(obs.accessibilitySummary, undefined, "screenshot: accessibility must stay unset");
      const dims = pngDimensions(Buffer.from(obs.screenshotBase64, "base64"));
      assert.deepEqual(dims, { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }, "screenshot: png IHDR");

      const clicks = await p.act(a.providerRef, {
        actions: [
          { type: "click_coordinates", x: 220, y: 180 },
          { type: "type", text: "flok" },
          { type: "key", key: "Return" },
          { type: "scroll", y: 3 },
        ],
      });
      assert.equal(clicks.ok, true, `click/type/key/scroll: ${JSON.stringify(clicks.results)}`);
      assert.equal(clicks.results.length, 4, "click/type/key/scroll: expected 4 results");
      for (const r of clicks.results) {
        assert.equal(r.success, true, `click/type/key/scroll: ${JSON.stringify(r)}`);
      }

      const marker = await p.filesystem(a.providerRef, {
        operation: "write",
        path: "/home/user/flok/c3b-marker",
        content: "workspace-disk",
      });
      assert.equal(marker.ok, true, "persistence marker write: failed");
      const profileWrite = await p.filesystem(a.providerRef, {
        operation: "write",
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
        content: "pwned",
      });
      assert.equal(profileWrite.ok, false, "bot must not write into the Chrome profile");

      const novnc = await mustExec(
        p,
        a.providerRef,
        [
          "python3",
          "-c",
          "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6080/', timeout=3); print('ok')",
        ],
        "noVNC localhost",
      );
      assert.match(novnc.stdout, /ok/, "noVNC localhost: unexpected body");

      const listen = await p.exec(a.providerRef, {
        argv: ["python3", "-c", LISTEN_CHECK],
        timeoutMs: 10_000,
      });
      assert.equal(
        listen.exitCode,
        0,
        `no public VNC bind: ${listen.stdout}\n${listen.stderr}`,
      );

      await p.pause(a.providerRef);
      await p.wake(a.providerRef);
      const whoAfter = await mustExec(p, a.providerRef, ["whoami"], "bot whoami after wake");
      assert.equal(whoAfter.stdout.trim(), FLOK_BOT_USER, "existing computer must still drop to flok after wake");

      const kept = await p.filesystem(a.providerRef, {
        operation: "read",
        path: "/home/user/flok/c3b-marker",
      });
      assert.equal(kept.ok, true, "suspend/resume marker survived: read failed");
      assert.equal(kept.data, "workspace-disk", "suspend/resume marker survived: content mismatch");

      const xvfb2 = await mustExec(
        p,
        a.providerRef,
        ["pgrep", "-u", "flok-ui", "-a", "Xvfb"],
        "graphical stack after resume (Xvfb)",
      );
      assert.match(xvfb2.stdout, /:99/, "graphical stack after resume: Xvfb :99 missing");
      const openbox2 = await mustExec(
        p,
        a.providerRef,
        ["pgrep", "-u", "flok-ui", "-a", "openbox"],
        "graphical stack after resume (Openbox)",
      );
      assert.match(openbox2.stdout, /openbox/i, "graphical stack after resume: Openbox missing");

      const relaunch = await p.act(a.providerRef, {
        actions: [{ type: "open_url", url: `file://${FIXTURE_WORKSPACE}` }],
      });
      assert.equal(relaunch.ok, true, `open_url relaunch accepted: ${JSON.stringify(relaunch.results)}`);

      await awaitChromeReady(p, a.providerRef, "chrome ready after resume");

      const after = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.ok(after.screenshotBase64, "screenshot after resume: missing png");
      const dims2 = pngDimensions(Buffer.from(after.screenshotBase64, "base64"));
      assert.deepEqual(
        dims2,
        { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
        "screenshot after resume: png IHDR",
      );
    } finally {
      for (const ref of refs) {
        await p.destroy(ref).catch((err: unknown) => {
          console.error("destroy failed", err);
        });
      }
    }
  });
});
