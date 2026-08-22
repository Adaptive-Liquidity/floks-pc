/**
 * Opt-in C3B live tests. Skipped unless FLOK_LIVE_RUNLOOP_C3B_TEST=1.
 * When the flag is set, missing credentials FAIL (never silent-skip).
 * Always destroy the paid Devbox in finally.
 *
 * open_url is launch-accepted (Popen), not Chrome-ready. This suite polls
 * pollUntilChromeReady after every launch before continuing.
 *
 * Do not run from ordinary verify / PR CI.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { RunloopProvider } from "../../src/lib/computers/providers/index.js";
import type { ExecResult } from "../../src/lib/computers/types.js";
import {
  BROWSER_PROFILE_DIR,
  CHROME_READY_PROBE_PY,
  CHROME_READY_TIMEOUT_MS,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  FIXTURE_PATH,
  chromeHasNoSandbox,
  chromeHasUserDataDir,
  chromeProfileHasBrowserState,
  chromeSandboxDisabled,
  formatChromeReadyFailure,
  parseChromeReadyEvidence,
  pngDimensions,
  pollUntilChromeReady,
  type ChromeReadyEvidence,
} from "../../src/lib/computers/providers/runloop-interactive.js";

const LIVE = process.env.FLOK_LIVE_RUNLOOP_C3B_TEST === "1";

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

function evidenceFromProbeStdout(stdout: string, stderr: string, stage: string): ChromeReadyEvidence {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  assert.ok(
    start >= 0 && end > start,
    `${stage}: chrome probe did not print JSON\nstdout=${stdout}\nstderr=${stderr}`,
  );
  try {
    return parseChromeReadyEvidence(trimmed.slice(start, end + 1));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${stage}: chrome probe JSON parse failed: ${detail}\nstdout=${stdout}\nstderr=${stderr}`,
    );
  }
}

async function awaitChromeReady(
  p: RunloopProvider,
  ref: string,
  stage: string,
): Promise<ChromeReadyEvidence> {
  const { result, evidence } = await pollUntilChromeReady(
    async () => {
      const r = await p.exec(ref, {
        argv: ["python3", "-c", CHROME_READY_PROBE_PY],
        timeoutMs: 15_000,
      });
      assert.equal(
        r.exitCode,
        0,
        `${stage}: chrome readiness probe failed\nstdout=${r.stdout}\nstderr=${r.stderr}`,
      );
      return evidenceFromProbeStdout(r.stdout, r.stderr, stage);
    },
    { requireProfile: true },
  );
  if (!result.ready) {
    assert.fail(`${stage}: ${formatChromeReadyFailure(result, evidence)}`);
  }
  const ours = evidence.chromeCmdlines.filter(
    (c) => /google-chrome/.test(c) || chromeHasUserDataDir(c),
  );
  assert.ok(
    ours.some(chromeHasUserDataDir),
    `${stage}: Chrome ready but --user-data-dir missing\n${formatChromeReadyFailure(result, evidence)}`,
  );
  assert.equal(
    ours.some(chromeSandboxDisabled),
    false,
    `${stage}: Chrome sandbox disabled\n${formatChromeReadyFailure(result, evidence)}`,
  );
  assert.equal(
    ours.some(chromeHasNoSandbox),
    false,
    `${stage}: Chrome cmdline contains --no-sandbox\n${formatChromeReadyFailure(result, evidence)}`,
  );
  assert.ok(
    chromeProfileHasBrowserState(evidence.profileEntries) ||
      chromeProfileHasBrowserState(evidence.profileEntriesUi),
    `${stage}: Chrome process/window up but profile not initialized\n${formatChromeReadyFailure(result, evidence)}`,
  );
  return evidence;
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

      const opened = await p.act(a.providerRef, {
        actions: [{ type: "open_url", url: `file://${FIXTURE_PATH}` }],
      });
      assert.equal(opened.ok, true, `open_url launch accepted: ${JSON.stringify(opened.results)}`);

      await awaitChromeReady(p, a.providerRef, "chrome ready after open_url");

      const profileList = await p.filesystem(a.providerRef, {
        operation: "list",
        path: BROWSER_PROFILE_DIR,
      });
      assert.equal(profileList.ok, true, "profile initialized (filesystem.list): list failed");
      assert.ok(
        Array.isArray(profileList.data) && profileList.data.length > 0,
        `profile initialized (filesystem.list): empty array after readiness probe data=${JSON.stringify(profileList.data)}`,
      );

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
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
        content: "profile-disk",
      });
      assert.equal(marker.ok, true, "persistence marker write: failed");

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

      const kept = await p.filesystem(a.providerRef, {
        operation: "read",
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
      });
      assert.equal(kept.ok, true, "suspend/resume marker survived: read failed");
      assert.equal(kept.data, "profile-disk", "suspend/resume marker survived: content mismatch");

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
        actions: [{ type: "open_url", url: `file://${FIXTURE_PATH}` }],
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
