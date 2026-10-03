/**
 * ENSURE_UI_BROWSER_PY: fd chown/chmod, quarantine untrusted dirs, never adopt.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENSURE_UI_BROWSER_PY } from "../../src/lib/computers/providers/runloop-bot-user.js";

function sudoOk(): boolean {
  return spawnSync("sudo", ["-n", "true"]).status === 0;
}

function sudo(
  cmd: string,
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("sudo", ["-n", "env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), "bash", "-lc", cmd], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("ENSURE_UI_BROWSER_PY (local root)", () => {
  it("quarantines leftover workspace .browser and untrusted UI dirs, then keeps a marked dir", () => {
    assert.equal(sudoOk(), true, "passwordless sudo is required");
    const root = mkdtempSync(join(tmpdir(), "flok-ui-browser-"));
    const ws = join(root, "ws");
    const uiParent = join(root, "home");
    const ui = join(uiParent, "flok-ui");
    try {
      mkdirSync(ws, { recursive: true });
      mkdirSync(uiParent, { recursive: true });
      mkdirSync(join(ws, ".browser", "profile"), { recursive: true });
      writeFileSync(join(ws, ".browser", "profile", "Cookies"), "old-cookies");
      mkdirSync(join(ui, ".flok-browser"), { recursive: true });
      writeFileSync(join(ui, ".flok-browser", "Cookies"), "flok-planted");
      symlinkSync("/tmp/evil", join(ui, ".config"));

      const first = spawnSync("sudo", ["-n", "env", `FLOK_UI_HOME=${ui}`, `FLOK_BOT_HOME=${ws}`, "FLOK_UI_UID=1500", "python3", "-c", ENSURE_UI_BROWSER_PY], {
        encoding: "utf8",
      });
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stderr, /quarantined leftover workspace \.browser/);
      assert.match(first.stderr, /quarantined untrusted/);

      const wsList = sudo(`ls -1A ${ws}`);
      assert.equal(wsList.status, 0, wsList.stderr);
      assert.equal(wsList.stdout.split("\n").includes(".browser"), false);
      assert.match(wsList.stdout, /\.browser\.quarantine-/);

      const uiStat = sudo(`stat -c '%u %g %a %F' ${ui}`);
      assert.match(uiStat.stdout, /^0 0 755 directory/);
      const browser = join(ui, ".flok-browser");
      const bStat = sudo(`stat -c '%u %g %a %F' ${browser}`);
      assert.match(bStat.stdout, /^1500 1500 700 directory/);
      const marker = sudo(`stat -c '%u %g %a %F' ${browser}/.flok-root`);
      assert.match(marker.stdout, /^0 0 600 regular/);
      const profile = sudo(`stat -c '%u %g %a %F' ${browser}/profile`);
      assert.match(profile.stdout, /^1500 1500 700 directory/);
      assert.equal(sudo(`test -e ${browser}/Cookies`).status, 1);
      const uiList = sudo(`ls -1A ${ui}`);
      assert.equal(uiList.status, 0, uiList.stderr);
      assert.match(uiList.stdout, /\.flok-browser\.quarantine-/);

      const second = spawnSync("sudo", ["-n", "env", `FLOK_UI_HOME=${ui}`, `FLOK_BOT_HOME=${ws}`, "FLOK_UI_UID=1500", "python3", "-c", ENSURE_UI_BROWSER_PY], {
        encoding: "utf8",
      });
      assert.equal(second.status, 0, second.stderr);
      assert.doesNotMatch(second.stderr, /quarantined untrusted/);
      const marker2 = sudo(`stat -c '%u %g %a %F' ${browser}/.flok-root`);
      assert.match(marker2.stdout, /^0 0 600 regular/);

      const chownMarker = sudo(`chown 1500:1500 ${browser}/.flok-root`);
      assert.equal(chownMarker.status, 0, chownMarker.stderr);
      const third = spawnSync("sudo", ["-n", "env", `FLOK_UI_HOME=${ui}`, `FLOK_BOT_HOME=${ws}`, "FLOK_UI_UID=1500", "python3", "-c", ENSURE_UI_BROWSER_PY], {
        encoding: "utf8",
      });
      assert.equal(third.status, 0, third.stderr);
      assert.match(third.stderr, /quarantined untrusted/);
      const marker3 = sudo(`stat -c '%u %g %a %F' ${browser}/.flok-root`);
      assert.match(marker3.stdout, /^0 0 600 regular/);
    } finally {
      spawnSync("sudo", ["-n", "rm", "-rf", root]);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("kills leftover workspace-profile Chrome before quarantining .browser", () => {
    assert.equal(sudoOk(), true, "passwordless sudo is required");
    const root = mkdtempSync(join(tmpdir(), "flok-ui-kill-"));
    const ws = join(root, "ws");
    const uiParent = join(root, "home");
    const ui = join(uiParent, "flok-ui");
    mkdirSync(ws, { recursive: true });
    mkdirSync(uiParent, { recursive: true });
    mkdirSync(join(ws, ".browser", "profile"), { recursive: true });
    try {
      const start = ENSURE_UI_BROWSER_PY.indexOf("def kill_old_workspace_chrome():");
      const end = ENSURE_UI_BROWSER_PY.indexOf("def ensure_dir(");
      assert.ok(start >= 0 && end > start);
      const killScript = [
        "import os,time,sys,subprocess",
        `UI_UID=${process.getuid()}`,
        ENSURE_UI_BROWSER_PY.slice(start, end),
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)','google-chrome-stable','--user-data-dir=/home/user/flok/.browser/profile'])",
        "time.sleep(0.2)",
        "pid=child.pid",
        "kill_old_workspace_chrome()",
        "time.sleep(0.2)",
        "if child.poll() is None:",
        "    child.kill(); sys.exit(2)",
        "print('stopped', pid)",
      ].join("\n");
      const killed = spawnSync("python3", ["-c", killScript], { encoding: "utf8" });
      assert.equal(killed.status, 0, killed.stderr);
      assert.match(killed.stdout, /stopped /);
      const ran = spawnSync(
        "sudo",
        ["-n", "env", `FLOK_UI_HOME=${ui}`, `FLOK_BOT_HOME=${ws}`, "FLOK_UI_UID=1500", "python3", "-c", ENSURE_UI_BROWSER_PY],
        { encoding: "utf8" },
      );
      assert.equal(ran.status, 0, ran.stderr);
      assert.match(ran.stderr, /quarantined leftover workspace \.browser/);
    } finally {
      spawnSync("sudo", ["-n", "rm", "-rf", root]);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
