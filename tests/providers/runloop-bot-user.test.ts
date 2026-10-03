/**
 * Unprivileged bot user — unpaid adversarial coverage.
 * MemoryRunloopControlPlane only. Not live Runloop proof.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MemoryRunloopControlPlane,
  RunloopProvider,
  RUNLOOP_WORKSPACE_ROOT,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.js";
import {
  BOT_BROWSER_DIR,
  BOT_DEFAULT_ENV,
  CONTROL_PLANE_CDP_AX_PATH,
  CONTROL_PLANE_CDP_RUNTIME_DIR,
  CONTROL_PLANE_DIR,
  CONTROL_PLANE_EXECVP_PATH,
  ENSURE_BOT_USER_SH,
  FLOK_BOT_HOME,
  FLOK_BOT_PATH,
  FLOK_BOT_UID,
  FLOK_BOT_USER,
  LEGACY_WORKSPACE_HELPER_DIR,
  applyBotUserToExec,
  argvAsBotUser,
  argvTouchesReserved,
  filterBotVisibleListing,
  isReservedControlPlanePath,
  unwrapBotArgv,
} from "../../src/lib/computers/providers/runloop-bot-user.js";
import {
  argvAsUiUser,
  BROWSER_PROFILE_DIR,
  FLOK_UI_USER,
} from "../../src/lib/computers/providers/runloop-interactive.js";
import {
  GUEST_FS_MAX_BYTES,
  GUEST_NOFOLLOW_READ_B64_PY,
  GUEST_NOFOLLOW_WRITE_STDIN_PY,
  GUEST_NOFOLLOW_LIST_PY,
  GUEST_NOFOLLOW_STAT_PY,
} from "../../src/lib/computers/providers/runloop-fs.js";
type MemorySession = {
  plantControlPlaneHelpers: () => void;
  plantLegacyHelpers: () => void;
  plantBrowserCookies: () => void;
  plantOwnedFile: (path: string, content: string, owner: "flok" | "flok-ui" | "root") => void;
  plantOwnedDir: (path: string, owner?: "flok" | "flok-ui" | "root") => void;
  plantSymlink: (path: string, target: string) => void;
  armSymlinkRace: (path: string, target: string) => void;
  peekRead: (path: string) => Buffer | null;
  peekOwner: (path: string) => string | undefined;
  peekIsSymlink: (path: string) => boolean;
  peekExists: (path: string) => boolean;
  peekList: (path: string) => string[];
  peekMode: (path: string) => number | undefined;
  chownLog: Array<{ path: string; user: string; noDeref: boolean; recursive: boolean }>;
  raceFired: number;
  raceWins: number;
  botUserEnsureCount: number;
  botUserReady: boolean;
  ensureBotUser: () => Promise<void>;
  fsStat: (path: string) => Promise<{ ok: boolean; errorCode?: string }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const distBotUser = join(here, "../../dist/lib/computers/providers/runloop-bot-user.js");

function provider(plane = new MemoryRunloopControlPlane()): {
  plane: MemoryRunloopControlPlane;
  p: RunloopProvider;
} {
  return { plane, p: new RunloopProvider({ client: plane, blueprint: "memory-linux-vm" }) };
}

async function ready() {
  const { plane, p } = provider();
  const a = await p.provision({ birdId: "bot-user", flockId: "f" });
  return { plane, p, ref: a.providerRef };
}

describe("bot user argv wrapping (no shell)", () => {
  it("drops to flok with forced HOME/USER/PATH and no shell concatenation", () => {
    const wrapped = argvAsBotUser(["whoami"]);
    assert.deepEqual(wrapped.slice(0, 5), ["runuser", "-u", FLOK_BOT_USER, "--", "env"]);
    assert.ok(wrapped.includes(`HOME=${FLOK_BOT_HOME}`));
    assert.ok(wrapped.includes(`USER=${FLOK_BOT_USER}`));
    assert.ok(wrapped.includes(`PATH=${FLOK_BOT_PATH}`));
    assert.equal(wrapped[wrapped.length - 1], "whoami");
    assert.equal(wrapped.includes("sh"), false);
    assert.equal(wrapped.includes("-c"), false);
    assert.equal(wrapped.includes("-lc"), false);
    assert.notEqual(FLOK_BOT_USER, FLOK_UI_USER);
    assert.notEqual(FLOK_BOT_USER, "root");
    assert.equal(FLOK_BOT_UID, 1501);
  });

  it("does not let request.env override HOME/USER/PATH", () => {
    const applied = applyBotUserToExec({
      argv: ["printenv", "HOME"],
      cwd: RUNLOOP_WORKSPACE_ROOT,
      env: { HOME: "/root", USER: "root", PATH: "/evil", LOGNAME: "root" },
      timeoutMs: 1000,
    });
    assert.equal(applied.env.HOME, FLOK_BOT_HOME);
    assert.equal(applied.env.USER, FLOK_BOT_USER);
    assert.equal(applied.env.PATH, FLOK_BOT_PATH);
    assert.equal(applied.env.LOGNAME, FLOK_BOT_USER);
    const unwrapped = unwrapBotArgv(applied.argv);
    assert.equal(unwrapped.user, FLOK_BOT_USER);
    assert.equal(unwrapped.env.HOME, FLOK_BOT_HOME);
    assert.deepEqual(unwrapped.argv, ["printenv", "HOME"]);
  });

  it("keeps GUI drops on flok-ui, not the bot user", () => {
    const click = argvAsUiUser(["xdotool", "click", "1"]);
    assert.deepEqual(click.slice(0, 3), ["runuser", "-u", "flok-ui"]);
    assert.equal(click.includes(FLOK_BOT_USER), false);
  });
});

describe("reserved control-plane paths", () => {
  it("jails helpers, leftover .flok, and /run/flok-cdp", () => {
    assert.equal(isReservedControlPlanePath(CONTROL_PLANE_DIR), true);
    assert.equal(isReservedControlPlanePath(CONTROL_PLANE_EXECVP_PATH), true);
    assert.equal(isReservedControlPlanePath(CONTROL_PLANE_CDP_AX_PATH), true);
    assert.equal(isReservedControlPlanePath(CONTROL_PLANE_CDP_RUNTIME_DIR), true);
    assert.equal(isReservedControlPlanePath(`${CONTROL_PLANE_CDP_RUNTIME_DIR}/ws`), true);
    assert.equal(isReservedControlPlanePath(LEGACY_WORKSPACE_HELPER_DIR), true);
    assert.equal(isReservedControlPlanePath(`${LEGACY_WORKSPACE_HELPER_DIR}/execvp.py`), true);
    assert.equal(isReservedControlPlanePath(`${RUNLOOP_WORKSPACE_ROOT}/.flok/../.flok/cdp-ax.mjs`), true);
    assert.equal(isReservedControlPlanePath(`${RUNLOOP_WORKSPACE_ROOT}/notes.txt`), false);
    assert.equal(isReservedControlPlanePath(BOT_BROWSER_DIR), true);
    assert.equal(isReservedControlPlanePath(`${RUNLOOP_WORKSPACE_ROOT}/.browser/profile`), true);
    assert.equal(isReservedControlPlanePath(`${BROWSER_PROFILE_DIR}/Cookies`), true);
    assert.deepEqual(
      filterBotVisibleListing(RUNLOOP_WORKSPACE_ROOT, ["notes.txt", ".flok", ".browser"]),
      ["notes.txt"],
    );
    assert.equal(argvTouchesReserved(["cat", CONTROL_PLANE_EXECVP_PATH]), true);
    assert.equal(argvTouchesReserved(["ls", "-a", `${CONTROL_PLANE_DIR}/*`]), true);
    assert.equal(argvTouchesReserved(["find", "/run/flok-cdp"]), true);
    assert.equal(argvTouchesReserved(["cat", `${BROWSER_PROFILE_DIR}/Cookies`]), true);
    assert.equal(argvTouchesReserved(["cat", `${RUNLOOP_WORKSPACE_ROOT}/notes.txt`]), false);
  });
});

describe("ensure-bot-user script contract", () => {
  it("is idempotent, creates flok, locks /var/lib/flok, and never grants sudo", () => {
    assert.match(ENSURE_BOT_USER_SH, /if ! id -u "\$BOT_USER"/);
    assert.match(ENSURE_BOT_USER_SH, /useradd -M -u "\$BOT_UID"/);
    assert.match(ENSURE_BOT_USER_SH, /chmod 0700 "\$CTRL"/);
    assert.match(ENSURE_BOT_USER_SH, /rm -rf "\$WS\/\.flok"/);
    assert.match(ENSURE_BOT_USER_SH, /gpasswd -d "\$BOT_USER" sudo/);
    assert.match(ENSURE_BOT_USER_SH, /rm -f \/etc\/sudoers\.d\/flok/);
    assert.match(ENSURE_BOT_USER_SH, /nosudo=1/);
    assert.doesNotMatch(ENSURE_BOT_USER_SH, /NOPASSWD/);
    assert.doesNotMatch(ENSURE_BOT_USER_SH, /sudoers\.d\/flok >/);
    assert.doesNotMatch(ENSURE_BOT_USER_SH, /usermod -aG sudo/);
    assert.equal(ENSURE_BOT_USER_SH.includes("Function.toString"), false);
    assert.equal(ENSURE_BOT_USER_SH.startsWith("#!/bin/bash"), true);
    assert.match(ENSURE_BOT_USER_SH, /chown -h root:root "\$CTRL"/);
    assert.match(ENSURE_BOT_USER_SH, /chown -hP -R "\$BOT_USER:\$BOT_USER"/);
    assert.match(ENSURE_BOT_USER_SH, /chown -hP -R "\$UI_USER:\$UI_USER" "\$WS\/\.browser"/);
    assert.match(ENSURE_BOT_USER_SH, /replacing symlink \$WS\/\.browser/);
    assert.match(ENSURE_BOT_USER_SH, /chmod 1775 "\$WS"/);
    assert.doesNotMatch(ENSURE_BOT_USER_SH, /chown [^-].*"\$WS"/);
  });
});

describe("computer_exec as flok (memory — not live Runloop proof)", () => {
  it("whoami / id are the bot user, never root", async () => {
    const { plane, p, ref } = await ready();
    const who = await p.exec(ref, { argv: ["whoami"] });
    assert.equal(who.exitCode, 0);
    assert.equal(who.stdout.trim(), FLOK_BOT_USER);
    assert.notEqual(who.stdout.trim(), "root");
    const uid = await p.exec(ref, { argv: ["id", "-u"] });
    assert.equal(uid.stdout.trim(), String(FLOK_BOT_UID));
    assert.notEqual(uid.stdout.trim(), "0");
    const shell = await p.exec(ref, { argv: ["bash", "-lc", "whoami"] });
    assert.equal(shell.stdout.trim(), FLOK_BOT_USER);
    const control = await plane.get(ref);
    const rootWho = await control.exec({
      argv: ["whoami"],
      cwd: RUNLOOP_WORKSPACE_ROOT,
      timeoutMs: 1000,
    });
    assert.equal(rootWho.stdout.trim(), "root");
  });

  it("HOME/PATH/cwd are the workspace", async () => {
    const { p, ref } = await ready();
    const home = await p.exec(ref, { argv: ["printenv", "HOME"] });
    assert.equal(home.stdout, FLOK_BOT_HOME);
    const path = await p.exec(ref, { argv: ["printenv", "PATH"] });
    assert.equal(path.stdout, BOT_DEFAULT_ENV.PATH);
    const pwd = await p.exec(ref, { argv: ["pwd"] });
    assert.equal(pwd.stdout.trim(), RUNLOOP_WORKSPACE_ROOT);
    const forced = await p.exec(ref, {
      argv: ["printenv", "HOME"],
      env: { HOME: "/root" },
    });
    assert.equal(forced.stdout, FLOK_BOT_HOME);
  });

  it("sudo / su / pkexec do not escalate", async () => {
    const { p, ref } = await ready();
    for (const argv of [["sudo", "whoami"], ["su", "-", "root"], ["pkexec", "whoami"]] as string[][]) {
      const r = await p.exec(ref, { argv });
      assert.notEqual(r.exitCode, 0, argv.join(" "));
      assert.doesNotMatch(r.stdout, /^root$/m);
    }
  });

  it("cannot read, list, write, or delete helpers via exec (abs, glob, ls -a, find)", async () => {
    const { plane, p, ref } = await ready();
    const session = (await plane.get(ref)) as unknown as MemorySession;
    session.plantControlPlaneHelpers();
    session.plantLegacyHelpers();
    session.plantBrowserCookies();
    const attacks: string[][] = [
      ["cat", CONTROL_PLANE_EXECVP_PATH],
      ["cat", CONTROL_PLANE_CDP_AX_PATH],
      ["ls", CONTROL_PLANE_DIR],
      ["ls", "-a", CONTROL_PLANE_DIR],
      ["ls", `${CONTROL_PLANE_DIR}/*`],
      ["find", CONTROL_PLANE_DIR],
      ["find", "/var/lib/flok"],
      ["find", CONTROL_PLANE_CDP_RUNTIME_DIR],
      ["rm", "-f", CONTROL_PLANE_EXECVP_PATH],
      ["chmod", "777", CONTROL_PLANE_DIR],
      ["chown", "flok", CONTROL_PLANE_EXECVP_PATH],
      ["touch", `${CONTROL_PLANE_DIR}/pwned`],
      ["cat", `${LEGACY_WORKSPACE_HELPER_DIR}/execvp.py`],
      ["cat", `${RUNLOOP_WORKSPACE_ROOT}/.flok/../.flok/cdp-ax.mjs`],
      ["cat", `${BROWSER_PROFILE_DIR}/Cookies`],
      ["cat", `${BOT_BROWSER_DIR}/Local State`],
      ["ls", "-a", BOT_BROWSER_DIR],
      ["ls", BROWSER_PROFILE_DIR],
      ["bash", "-lc", `cat ${CONTROL_PLANE_EXECVP_PATH}`],
      ["bash", "-lc", `cat ${BROWSER_PROFILE_DIR}/Cookies`],
      ["python3", "-c", `open('${CONTROL_PLANE_EXECVP_PATH}').read()`],
      ["python3", "-c", `open('${BROWSER_PROFILE_DIR}/Cookies').read()`],
    ];
    for (const argv of attacks) {
      const r = await p.exec(ref, { argv });
      assert.notEqual(r.exitCode, 0, argv.join(" "));
      assert.doesNotMatch(r.stdout, /import os, sys, json/);
      assert.doesNotMatch(r.stdout, /execvp/);
      assert.doesNotMatch(r.stdout, /chrome-cookie-secret/);
      assert.doesNotMatch(r.stdout, /browser-local-state/);
    }
    const findHome = await p.exec(ref, {
      argv: ["find", RUNLOOP_WORKSPACE_ROOT, "-name", "execvp.py"],
    });
    assert.equal(findHome.exitCode, 0);
    assert.equal(findHome.stdout.trim(), "");
    const findRoot = await p.exec(ref, { argv: ["find", "/", "-name", "execvp.py"] });
    assert.equal(findRoot.stdout.includes("execvp.py"), false);
    const lsWorkspace = await p.exec(ref, { argv: ["ls", "-a", RUNLOOP_WORKSPACE_ROOT] });
    assert.equal(lsWorkspace.stdout.split("\n").includes(".flok"), false);
    assert.equal(lsWorkspace.stdout.split("\n").includes(".browser"), false);
    const lsVarLib = await p.exec(ref, { argv: ["ls", "-a", "/var/lib"] });
    assert.equal(lsVarLib.stdout.split("\n").includes("flok"), false);
    const cwdCookies = await p.exec(ref, {
      argv: ["cat", "Cookies"],
      cwd: BROWSER_PROFILE_DIR,
    });
    assert.notEqual(cwdCookies.exitCode, 0);
    assert.doesNotMatch(cwdCookies.stdout, /chrome-cookie-secret/);
  });
});

describe("computer_fs cannot reach helpers (memory — not live Runloop proof)", () => {
  it("rejects reserved paths including .., absolute, leftover .flok, and /run/flok-cdp", async () => {
    const { p, ref } = await ready();
    const paths = [
      LEGACY_WORKSPACE_HELPER_DIR,
      `${LEGACY_WORKSPACE_HELPER_DIR}/execvp.py`,
      `${RUNLOOP_WORKSPACE_ROOT}/.flok/cdp-ax.mjs`,
      `${RUNLOOP_WORKSPACE_ROOT}/notes/../.flok/execvp.py`,
      CONTROL_PLANE_DIR,
      CONTROL_PLANE_EXECVP_PATH,
      `${CONTROL_PLANE_CDP_RUNTIME_DIR}/sock`,
      "/etc/passwd",
      "/root/flok/execvp.py",
      BOT_BROWSER_DIR,
      BROWSER_PROFILE_DIR,
      `${BROWSER_PROFILE_DIR}/Cookies`,
      `${BOT_BROWSER_DIR}/Local State`,
      `${RUNLOOP_WORKSPACE_ROOT}/notes/../.browser/profile/Cookies`,
    ];
    for (const path of paths) {
      const read = await p.filesystem(ref, { operation: "read", path });
      assert.equal(read.ok, false, `read ${path}`);
      assert.ok(read.errorCode === "PERMISSION_DENIED" || read.errorCode === "PATH_ESCAPE", path);
      const write = await p.filesystem(ref, {
        operation: "write",
        path,
        content: "pwned",
      });
      assert.equal(write.ok, false, `write ${path}`);
      const del = await p.filesystem(ref, { operation: "delete", path });
      assert.equal(del.ok, false, `delete ${path}`);
    }
    const listed = await p.filesystem(ref, {
      operation: "list",
      path: RUNLOOP_WORKSPACE_ROOT,
    });
    assert.equal(listed.ok, true);
    const names = listed.data as string[];
    assert.equal(names.includes(".flok"), false);
    assert.equal(names.includes(".browser"), false);
    assert.equal(names.includes("execvp.py"), false);
    const ordinary = `${RUNLOOP_WORKSPACE_ROOT}/move-src.txt`;
    assert.equal(
      (await p.filesystem(ref, { operation: "write", path: ordinary, content: "src" })).ok,
      true,
    );
    const moveInto = await p.filesystem(ref, {
      operation: "move",
      path: ordinary,
      destination: `${LEGACY_WORKSPACE_HELPER_DIR}/hello-bot.txt`,
    });
    assert.equal(moveInto.ok, false);
    const copyInto = await p.filesystem(ref, {
      operation: "copy",
      path: ordinary,
      destination: CONTROL_PLANE_EXECVP_PATH,
    });
    assert.equal(copyInto.ok, false);
  });

  it("still writes and reads ordinary workspace files", async () => {
    const { p, ref } = await ready();
    const path = `${RUNLOOP_WORKSPACE_ROOT}/hello-bot.txt`;
    assert.equal(
      (await p.filesystem(ref, { operation: "write", path, content: "from-flok" })).ok,
      true,
    );
    const read = await p.filesystem(ref, { operation: "read", path });
    assert.equal(read.ok, true);
    assert.equal(read.data, "from-flok");
  });
});

describe("lazy ensure on existing computers (memory)", () => {
  it("removes leftover workspace helpers and is idempotent", async () => {
    const { plane, p } = provider();
    const a = await p.provision({ birdId: "legacy", flockId: "f" });
    const session = await plane.get(a.providerRef);
    const planted = session as unknown as {
      plantLegacyHelpers: () => void;
      botUserEnsureCount: number;
      ensureBotUser: () => Promise<void>;
    };
    planted.plantLegacyHelpers();
    const mem = session as unknown as MemorySession;
    assert.equal(mem.peekExists(LEGACY_WORKSPACE_HELPER_DIR), true);
    const beforeCleanup = await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR);
    assert.equal(beforeCleanup.ok, false);
    const hidden = await p.filesystem(a.providerRef, {
      operation: "list",
      path: RUNLOOP_WORKSPACE_ROOT,
    });
    assert.equal(hidden.ok, true);
    assert.equal((hidden.data as string[]).includes(".flok"), false);
    const blocked = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${LEGACY_WORKSPACE_HELPER_DIR}/execvp.py`,
    });
    assert.equal(blocked.ok, false);
    const before = planted.botUserEnsureCount;
    await planted.ensureBotUser();
    await planted.ensureBotUser();
    assert.ok(planted.botUserEnsureCount >= before + 2);
    assert.equal(mem.peekExists(LEGACY_WORKSPACE_HELPER_DIR), false);
    const gone = await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR);
    assert.equal(gone.ok, false);
    const who = await p.exec(a.providerRef, { argv: ["whoami"] });
    assert.equal(who.stdout.trim(), FLOK_BOT_USER);
  });

  it("wake of a pre-change computer re-runs ensure and still drops to flok", async () => {
    const { plane, p } = provider();
    const a = await p.provision({ birdId: "wake-legacy", flockId: "f" });
    const session = await plane.get(a.providerRef);
    const mem = session as unknown as MemorySession;
    mem.plantLegacyHelpers();
    assert.equal(mem.peekExists(LEGACY_WORKSPACE_HELPER_DIR), true);
    assert.equal((await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR)).ok, false);
    await p.pause(a.providerRef);
    await p.wake(a.providerRef);
    const who = await p.exec(a.providerRef, { argv: ["whoami"] });
    assert.equal(who.stdout.trim(), FLOK_BOT_USER);
    assert.equal(mem.peekExists(LEGACY_WORKSPACE_HELPER_DIR), false);
    assert.equal((await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR)).ok, false);
    const leftover = await p.filesystem(a.providerRef, {
      operation: "list",
      path: LEGACY_WORKSPACE_HELPER_DIR,
    });
    assert.equal(leftover.ok, false);
  });
});

describe("browser / screenshot / click still work after the switch", () => {
  it("observe and bounded act still succeed on the memory plane", async () => {
    const { plane, p, ref } = await ready();
    const obs = await p.observe(ref, { includeScreenshot: true });
    assert.equal(obs.screenWidth, 1440);
    assert.equal(obs.screenHeight, 900);
    assert.ok(obs.screenshotBase64 && obs.screenshotBase64.length > 10);
    const act = await p.act(ref, {
      actions: [
        { type: "open_url", url: "https://example.com/" },
        { type: "click_coordinates", x: 20, y: 20 },
        { type: "type", text: "hi" },
      ],
    });
    assert.equal(act.ok, true);
    const session = (await plane.get(ref)) as unknown as MemorySession;
    assert.equal(
      session.peekRead(`${BROWSER_PROFILE_DIR}/last-url`)?.toString("utf8"),
      "https://example.com/",
    );
    const marker = await p.filesystem(ref, {
      operation: "read",
      path: `${BROWSER_PROFILE_DIR}/last-url`,
    });
    assert.equal(marker.ok, false);
    assert.equal(marker.errorCode, "PERMISSION_DENIED");
  });
});

describe("computer_fs cannot reach the browser profile (memory — not live)", () => {
  it("denies bot fs read/write/list/delete of cookies, profile, and /var/lib/flok", async () => {
    const { plane, p, ref } = await ready();
    const session = (await plane.get(ref)) as unknown as MemorySession;
    session.plantBrowserCookies();
    session.plantControlPlaneHelpers();
    const attacks = [
      BOT_BROWSER_DIR,
      BROWSER_PROFILE_DIR,
      `${BROWSER_PROFILE_DIR}/Cookies`,
      `${BOT_BROWSER_DIR}/Local State`,
      CONTROL_PLANE_DIR,
      CONTROL_PLANE_EXECVP_PATH,
    ];
    for (const path of attacks) {
      for (const operation of ["read", "list", "stat", "delete"] as const) {
        const r = await p.filesystem(ref, { operation, path });
        assert.equal(r.ok, false, `${operation} ${path}`);
        assert.ok(
          r.errorCode === "PERMISSION_DENIED" || r.errorCode === "PATH_ESCAPE",
          `${operation} ${path} ${r.errorCode}`,
        );
        if (operation === "read") {
          assert.notEqual(r.data, "chrome-cookie-secret");
        }
      }
      const write = await p.filesystem(ref, {
        operation: "write",
        path,
        content: "pwned",
      });
      assert.equal(write.ok, false, `write ${path}`);
    }
    assert.equal(session.peekRead(`${BROWSER_PROFILE_DIR}/Cookies`)?.toString("utf8"), "chrome-cookie-secret");
    const listed = await p.filesystem(ref, {
      operation: "list",
      path: RUNLOOP_WORKSPACE_ROOT,
    });
    assert.equal(listed.ok, true);
    assert.equal((listed.data as string[]).includes(".browser"), false);
  });
});

describe("TOCTOU: never resolve-then-act as another user (memory)", () => {
  it("refuses a symlink swapped in after the jail check", async () => {
    const { plane, p, ref } = await ready();
    const session = (await plane.get(ref)) as unknown as MemorySession;
    session.plantBrowserCookies();
    session.plantOwnedFile("/etc/passwd", "root:x:0:0:root:/root:/bin/bash", "root");
    session.plantOwnedFile(`${CONTROL_PLANE_DIR}/secret`, "helper-secret", "root");
    const victim = `${RUNLOOP_WORKSPACE_ROOT}/race-victim.txt`;
    assert.equal(
      (await p.filesystem(ref, { operation: "write", path: victim, content: "benign" })).ok,
      true,
    );
    const chownsAfterWrite = session.chownLog.length;

    for (const target of ["/etc/passwd", `${CONTROL_PLANE_DIR}/secret`, `${BROWSER_PROFILE_DIR}/Cookies`]) {
      session.armSymlinkRace(victim, target);
      const read = await p.filesystem(ref, { operation: "read", path: victim });
      assert.equal(read.ok, false, `race read ${target}`);
      assert.equal(read.errorCode, "PERMISSION_DENIED", `race read ${target}`);
      assert.notEqual(read.data, "root:x:0:0:root:/root:/bin/bash");
      assert.notEqual(read.data, "helper-secret");
      assert.notEqual(read.data, "chrome-cookie-secret");
      session.armSymlinkRace(victim, target);
      const write = await p.filesystem(ref, {
        operation: "write",
        path: victim,
        content: "pwned-via-race",
      });
      assert.equal(write.ok, false, `race write ${target}`);
    }
    assert.ok(session.raceFired >= 6);
    assert.equal(session.peekRead("/etc/passwd")?.toString("utf8"), "root:x:0:0:root:/root:/bin/bash");
    assert.equal(session.peekRead(`${CONTROL_PLANE_DIR}/secret`)?.toString("utf8"), "helper-secret");
    assert.equal(session.chownLog.length, chownsAfterWrite);
  });

  it("parent-directory swap after the openat walk wins 0 of 2000 reads/writes", async () => {
    const { plane, p, ref } = await ready();
    const session = (await plane.get(ref)) as unknown as MemorySession;
    const notes = `${RUNLOOP_WORKSPACE_ROOT}/notes`;
    const victim = `${notes}/secret.txt`;
    const evil = `${RUNLOOP_WORKSPACE_ROOT}/evil-swap`;
    const evilFile = `${evil}/secret.txt`;
    assert.equal((await p.filesystem(ref, { operation: "mkdir", path: notes })).ok, true);
    assert.equal((await p.filesystem(ref, { operation: "mkdir", path: evil })).ok, true);
    assert.equal(
      (await p.filesystem(ref, { operation: "write", path: victim, content: "benign" })).ok,
      true,
    );
    assert.equal(
      (await p.filesystem(ref, { operation: "write", path: evilFile, content: "pwned-evil" })).ok,
      true,
    );

    let wins = 0;
    for (let i = 0; i < 2000; i += 1) {
      session.plantOwnedDir(notes, FLOK_BOT_USER);
      session.armSymlinkRace(notes, evil);
      const read = await p.filesystem(ref, { operation: "read", path: victim });
      if (read.ok && read.data === "pwned-evil") wins += 1;
      session.plantOwnedDir(notes, FLOK_BOT_USER);
      session.armSymlinkRace(notes, evil);
      const write = await p.filesystem(ref, {
        operation: "write",
        path: victim,
        content: `from-write-${i}`,
      });
      if (write.ok && session.peekRead(evilFile)?.toString("utf8") === `from-write-${i}`) {
        wins += 1;
      }
    }
    assert.equal(wins, 0);
    assert.equal(session.raceWins, 0);
    assert.ok(session.raceFired >= 4000);
    assert.equal(session.peekRead(evilFile)?.toString("utf8"), "pwned-evil");
    assert.notEqual(session.peekRead(victim)?.toString("utf8"), "pwned-evil");
  });
});

describe("computer_fs size cap and byte-exact round-trip (memory)", () => {
  it("round-trips 0 B, 71 KiB, 72 KiB, 200 KiB, max; FILE_TOO_LARGE above max; binary exact", async () => {
    const { plane, p, ref } = await ready();
    const session = await plane.get(ref);
    const cases: Array<{ name: string; body: Buffer }> = [
      { name: "empty.bin", body: Buffer.alloc(0) },
      { name: "71kib.bin", body: Buffer.alloc(71 * 1024, 0x41) },
      { name: "72kib.bin", body: Buffer.alloc(72 * 1024, 0x42) },
      { name: "200kib.bin", body: Buffer.alloc(200 * 1024, 0x43) },
      { name: "max.bin", body: Buffer.alloc(GUEST_FS_MAX_BYTES, 0x44) },
    ];
    for (const { name, body } of cases) {
      if (body.length >= 8) {
        body[0] = 0x00;
        body[1] = 0xff;
        body[2] = 0xfe;
        body.writeUInt32BE(0xdeadbeef, 3);
      }
      const path = `${RUNLOOP_WORKSPACE_ROOT}/${name}`;
      const write = await session.fsWrite(path, body);
      assert.equal(write.ok, true, `write ${name}`);
      const read = await session.fsRead(path);
      assert.equal(read.ok, true, `read ${name}`);
      assert.ok(read.data);
      assert.equal(read.data.equals(body), true, `round-trip ${name} ${body.length}`);
      const viaProvider = await p.filesystem(ref, {
        operation: "read",
        path,
        encoding: "base64",
      });
      assert.equal(viaProvider.ok, true, `provider read ${name}`);
      assert.equal(
        Buffer.from(String(viaProvider.data), "base64").equals(body),
        true,
        `provider ${name}`,
      );
    }
    const over = Buffer.alloc(GUEST_FS_MAX_BYTES + 1, 0x45);
    const tooBig = await session.fsWrite(`${RUNLOOP_WORKSPACE_ROOT}/over.bin`, over);
    assert.equal(tooBig.ok, false);
    assert.equal(tooBig.errorCode, "FILE_TOO_LARGE");
    const viaProvider = await p.filesystem(ref, {
      operation: "write",
      path: `${RUNLOOP_WORKSPACE_ROOT}/over2.bin`,
      content: "x".repeat(GUEST_FS_MAX_BYTES + 1),
    });
    assert.equal(viaProvider.ok, false);
    assert.equal(viaProvider.errorCode, "FILE_TOO_LARGE");
  });
});

describe(".browser ownership and sticky workspace (memory)", () => {
  it("owns .browser as flok-ui, sticky workspace, and replaces a planted symlink on wake", async () => {
    const { plane, p } = provider();
    const a = await p.provision({ birdId: "browser-sticky", flockId: "f" });
    const session = (await plane.get(a.providerRef)) as unknown as MemorySession;
    assert.equal(session.peekMode(RUNLOOP_WORKSPACE_ROOT), 0o1775);
    assert.equal(session.peekOwner(BOT_BROWSER_DIR), FLOK_UI_USER);
    assert.equal(session.peekMode(BOT_BROWSER_DIR), 0o700);
    assert.equal(session.peekIsSymlink(BOT_BROWSER_DIR), false);

    session.plantSymlink(BOT_BROWSER_DIR, "/tmp/evil-browser");
    assert.equal(session.peekIsSymlink(BOT_BROWSER_DIR), true);
    session.botUserReady = false;
    await session.ensureBotUser();
    assert.equal(session.peekIsSymlink(BOT_BROWSER_DIR), false);
    assert.equal(session.peekOwner(BOT_BROWSER_DIR), FLOK_UI_USER);
    assert.equal(session.peekMode(BOT_BROWSER_DIR), 0o700);
    assert.equal(session.peekMode(RUNLOOP_WORKSPACE_ROOT), 0o1775);

    session.plantSymlink(BOT_BROWSER_DIR, "/tmp/evil-browser-2");
    await p.pause(a.providerRef);
    await p.wake(a.providerRef);
    const afterWake = (await plane.get(a.providerRef)) as unknown as MemorySession;
    assert.equal(afterWake.peekIsSymlink(BOT_BROWSER_DIR), false);
    assert.equal(afterWake.peekOwner(BOT_BROWSER_DIR), FLOK_UI_USER);

    const mv = await p.exec(a.providerRef, {
      argv: ["mv", BOT_BROWSER_DIR, `${RUNLOOP_WORKSPACE_ROOT}/stolen-browser`],
    });
    assert.notEqual(mv.exitCode, 0);
    assert.equal(afterWake.peekExists(BOT_BROWSER_DIR), true);
    assert.equal(afterWake.peekOwner(BOT_BROWSER_DIR), FLOK_UI_USER);
    const ln = await p.exec(a.providerRef, {
      argv: ["ln", "-s", "/tmp/evil", BOT_BROWSER_DIR],
    });
    assert.notEqual(ln.exitCode, 0);
    assert.equal(afterWake.peekIsSymlink(BOT_BROWSER_DIR), false);
  });
});

describe("ensure chown never follows planted symlinks (memory)", () => {
  it("does not chown /etc or /var/lib/flok through workspace symlinks", async () => {
    const { plane, p } = provider();
    const a = await p.provision({ birdId: "chown-race", flockId: "f" });
    const session = (await plane.get(a.providerRef)) as unknown as MemorySession;
    session.plantOwnedFile("/etc/passwd", "root:x:0:0:root:/root:/bin/bash", "root");
    session.plantControlPlaneHelpers();
    session.plantSymlink(`${RUNLOOP_WORKSPACE_ROOT}/to-etc`, "/etc");
    session.plantSymlink(`${RUNLOOP_WORKSPACE_ROOT}/to-helpers`, CONTROL_PLANE_DIR);
    session.plantSymlink(`${RUNLOOP_WORKSPACE_ROOT}/to-passwd`, "/etc/passwd");
    session.botUserReady = false;
    const before = session.chownLog.length;
    await session.ensureBotUser();
    await session.ensureBotUser();
    assert.equal(session.peekOwner("/etc/passwd"), "root");
    assert.equal(session.peekOwner(CONTROL_PLANE_DIR), "root");
    assert.equal(session.peekOwner(CONTROL_PLANE_EXECVP_PATH), "root");
    assert.equal(session.peekRead("/etc/passwd")?.toString("utf8"), "root:x:0:0:root:/root:/bin/bash");
    assert.equal(session.peekIsSymlink(`${RUNLOOP_WORKSPACE_ROOT}/to-etc`), true);
    assert.equal(session.peekIsSymlink(`${RUNLOOP_WORKSPACE_ROOT}/to-helpers`), true);
    for (const call of session.chownLog.slice(before)) {
      assert.equal(call.noDeref, true);
      assert.equal(call.path === "/etc" || call.path.startsWith("/etc/"), false);
      assert.equal(call.path === CONTROL_PLANE_DIR || call.path.startsWith(`${CONTROL_PLANE_DIR}/`), false);
    }
    const readEtc = await p.filesystem(a.providerRef, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/to-passwd`,
    });
    assert.equal(readEtc.ok, false);
    assert.equal(readEtc.errorCode, "PERMISSION_DENIED");
  });
});

describe("customer fs guest scripts are nofollow and not root file API", () => {
  it("opens with openat + O_NOFOLLOW and never Function.toString()", () => {
    for (const src of [
      GUEST_NOFOLLOW_STAT_PY,
      GUEST_NOFOLLOW_LIST_PY,
      GUEST_NOFOLLOW_READ_B64_PY,
      GUEST_NOFOLLOW_WRITE_STDIN_PY,
    ]) {
      assert.match(src, /O_NOFOLLOW/);
      assert.match(src, /dir_fd=/);
      assert.equal(src.includes("Function.toString"), false);
    }
    const sdk = readFileSync(join(here, "../../src/lib/computers/providers/runloop-sdk.ts"), "utf8");
    assert.match(sdk, /GUEST_NOFOLLOW_READ_B64_PY/);
    assert.match(sdk, /GUEST_NOFOLLOW_WRITE_STDIN_PY/);
    assert.match(sdk, /--spec-file/);
    assert.match(sdk, /stdin_b64/);
    assert.match(sdk, /FILE_TOO_LARGE/);
    assert.match(sdk, /argvAsBotUser\(guestArgv\)/);
    assert.equal(sdk.includes("GUEST_NOFOLLOW_WRITE_B64_PY"), false);
    assert.equal(sdk.includes("ownForBot"), false);
    assert.equal(sdk.includes("enforceResolved"), false);
    assert.equal(sdk.includes("privilegedGuestFs"), false);
    const fsRead = sdk.slice(sdk.indexOf("async fsRead("), sdk.indexOf("async fsWrite("));
    const fsWrite = sdk.slice(sdk.indexOf("async fsWrite("), sdk.indexOf("async fsMkdir("));
    const fsList = sdk.slice(sdk.indexOf("async fsList("), sdk.indexOf("async fsRead("));
    const fsDelete = sdk.slice(sdk.indexOf("async fsDelete("), sdk.indexOf("async fsMove("));
    for (const body of [fsRead, fsWrite, fsList, fsDelete]) {
      assert.equal(body.includes("this.box.file"), false);
      assert.equal(body.includes("box.file.read"), false);
      assert.equal(body.includes("box.file.write"), false);
      assert.equal(body.includes("box.file.download"), false);
    }
    const specWrite = sdk.slice(sdk.indexOf("private async execViaSpecFile("));
    assert.match(specWrite, /CONTROL_PLANE_FS_SPEC_PATH/);
    assert.match(specWrite, /--spec-file/);
    assert.equal(specWrite.includes("/home/user/flok/"), false);
  });
});

describe("MCP surface stays eight tools", () => {
  it("does not add a tool for the privilege drop", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
    assert.deepEqual([...MCP_TOOL_NAMES], [
      "computer_pair",
      "computer_status",
      "computer_exec",
      "computer_fs",
      "computer_observe",
      "computer_act",
      "handoff_send",
      "handoff_receive",
    ]);
  });
});

describe("production build output (tsc dist)", () => {
  it("keeps guest scripts as string constants after compile", async () => {
    if (!existsSync(distBotUser)) {
      if (process.env.FLOK_REQUIRE_DIST === "1") {
        assert.fail("dist/lib/computers/providers/runloop-bot-user.js missing after production build");
      }
      return;
    }
    const mod = (await import(pathToFileURL(distBotUser).href)) as {
      argvAsBotUser: (argv: string[]) => string[];
      ENSURE_BOT_USER_SH: string;
      isReservedControlPlanePath: (path: string) => boolean;
      FLOK_BOT_USER: string;
    };
    assert.equal(mod.FLOK_BOT_USER, "flok");
    assert.deepEqual(mod.argvAsBotUser(["whoami"]).slice(0, 3), ["runuser", "-u", "flok"]);
    assert.match(mod.ENSURE_BOT_USER_SH, /nosudo=1/);
    assert.equal(mod.isReservedControlPlanePath("/var/lib/flok/execvp.py"), true);
    assert.equal(mod.ENSURE_BOT_USER_SH.includes("function()"), false);
  });
});
