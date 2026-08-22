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
import type { ExecResult } from "../../src/lib/computers/types.js";
import {
  BROWSER_PROFILE_DIR,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  FIXTURE_PATH,
  pngDimensions,
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
): Promise<ExecResult> {
  const r = await p.exec(ref, { argv, timeoutMs: 20_000 });
  assert.equal(r.exitCode, 0, `${argv.join(" ")}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  return r;
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
    assert.equal(caps.computerUse, false);
    assert.equal(caps.vnc, false);
    assert.equal(caps.accessibility, false);
    assert.equal(caps.pauseMemory, false);

    const refs: string[] = [];
    try {
      const a = await p.provision({ birdId: "c3b-live", flockId: "flock-live" });
      refs.push(a.providerRef);

      const tools = await mustExec(p, a.providerRef, [
        "bash",
        "-lc",
        "command -v docker && command -v git && command -v python3 && command -v node",
      ]);
      assert.match(tools.stdout, /docker/);
      assert.match(tools.stdout, /git/);
      assert.match(tools.stdout, /python3/);
      assert.match(tools.stdout, /node/);

      const ui = await mustExec(p, a.providerRef, ["id", "-u", "flok-ui"]);
      assert.equal(ui.stdout.trim(), "1500");

      const chromeVer = await mustExec(p, a.providerRef, ["cat", "/etc/flok-chrome-version"]);
      assert.match(chromeVer.stdout, /Google Chrome/i);
      console.log("C3B chrome version", chromeVer.stdout.trim());

      const xvfb = await mustExec(p, a.providerRef, ["pgrep", "-u", "flok-ui", "-a", "Xvfb"]);
      assert.match(xvfb.stdout, /:99/);
      const openbox = await mustExec(p, a.providerRef, ["pgrep", "-u", "flok-ui", "-a", "openbox"]);
      assert.match(openbox.stdout, /openbox/i);

      const opened = await p.act(a.providerRef, {
        actions: [
          { type: "open_url", url: `file://${FIXTURE_PATH}` },
          { type: "wait", durationMs: 2500 },
        ],
      });
      assert.equal(opened.ok, true, JSON.stringify(opened.results));

      const chromePs = await mustExec(p, a.providerRef, [
        "bash",
        "-lc",
        "pgrep -u flok-ui -af 'google-chrome|chrome' || true",
      ]);
      assert.match(chromePs.stdout, /google-chrome|chrome/);
      assert.match(chromePs.stdout, /--user-data-dir=\/home\/user\/flok\/\.browser\/profile/);
      assert.doesNotMatch(chromePs.stdout, /--no-sandbox/);

      const profileList = await p.filesystem(a.providerRef, {
        operation: "list",
        path: BROWSER_PROFILE_DIR,
      });
      assert.equal(profileList.ok, true);
      assert.ok(Array.isArray(profileList.data) && profileList.data.length > 0);

      const obs = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.equal(obs.screenWidth, DISPLAY_WIDTH);
      assert.equal(obs.screenHeight, DISPLAY_HEIGHT);
      assert.ok(obs.screenshotBase64 && obs.screenshotBase64.length > 100);
      assert.equal(obs.accessibilitySummary, undefined);
      const dims = pngDimensions(Buffer.from(obs.screenshotBase64, "base64"));
      assert.deepEqual(dims, { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT });

      const clicks = await p.act(a.providerRef, {
        actions: [
          { type: "click_coordinates", x: 220, y: 180 },
          { type: "type", text: "flok" },
          { type: "key", key: "Return" },
          { type: "scroll", y: 3 },
        ],
      });
      assert.equal(clicks.ok, true, JSON.stringify(clicks.results));
      assert.equal(clicks.results.length, 4);
      for (const r of clicks.results) assert.equal(r.success, true, JSON.stringify(r));

      await p.filesystem(a.providerRef, {
        operation: "write",
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
        content: "profile-disk",
      });

      const novnc = await mustExec(p, a.providerRef, [
        "python3",
        "-c",
        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6080/', timeout=3); print('ok')",
      ]);
      assert.match(novnc.stdout, /ok/);

      const listen = await p.exec(a.providerRef, {
        argv: ["python3", "-c", LISTEN_CHECK],
        timeoutMs: 10_000,
      });
      assert.equal(listen.exitCode, 0, `public VNC bind: ${listen.stdout}\n${listen.stderr}`);

      await p.pause(a.providerRef);
      await p.wake(a.providerRef);

      const kept = await p.filesystem(a.providerRef, {
        operation: "read",
        path: `${BROWSER_PROFILE_DIR}/c3b-marker`,
      });
      assert.equal(kept.ok, true);
      assert.equal(kept.data, "profile-disk");

      const xvfb2 = await mustExec(p, a.providerRef, ["pgrep", "-u", "flok-ui", "-a", "Xvfb"]);
      assert.match(xvfb2.stdout, /:99/);
      const openbox2 = await mustExec(p, a.providerRef, ["pgrep", "-u", "flok-ui", "-a", "openbox"]);
      assert.match(openbox2.stdout, /openbox/i);

      const relaunch = await p.act(a.providerRef, {
        actions: [
          { type: "open_url", url: `file://${FIXTURE_PATH}` },
          { type: "wait", durationMs: 2500 },
        ],
      });
      assert.equal(relaunch.ok, true, JSON.stringify(relaunch.results));

      const chromePs2 = await mustExec(p, a.providerRef, [
        "bash",
        "-lc",
        "pgrep -u flok-ui -af 'google-chrome|chrome' || true",
      ]);
      assert.match(chromePs2.stdout, /google-chrome|chrome/);
      assert.doesNotMatch(chromePs2.stdout, /--no-sandbox/);

      const after = await p.observe(a.providerRef, { includeScreenshot: true });
      assert.ok(after.screenshotBase64);
      const dims2 = pngDimensions(Buffer.from(after.screenshotBase64, "base64"));
      assert.deepEqual(dims2, { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT });
    } finally {
      for (const ref of refs) {
        await p.destroy(ref).catch((err: unknown) => {
          console.error("destroy failed", err);
        });
      }
    }
  });
});
