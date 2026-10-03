/**
 * Unprivileged bot user — unpaid adversarial coverage.
 * MemoryRunloopControlPlane only. Not live Runloop proof.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MemoryRunloopControlPlane,
  RunloopProvider,
  RUNLOOP_WORKSPACE_ROOT,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.js";
import {
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
  FLOK_UI_USER,
} from "../../src/lib/computers/providers/runloop-interactive.js";

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
    assert.equal(isReservedControlPlanePath(`${RUNLOOP_WORKSPACE_ROOT}/.browser/profile`), false);
    assert.deepEqual(
      filterBotVisibleListing(RUNLOOP_WORKSPACE_ROOT, ["notes.txt", ".flok", ".browser"]),
      ["notes.txt", ".browser"],
    );
    assert.equal(argvTouchesReserved(["cat", CONTROL_PLANE_EXECVP_PATH]), true);
    assert.equal(argvTouchesReserved(["ls", "-a", `${CONTROL_PLANE_DIR}/*`]), true);
    assert.equal(argvTouchesReserved(["find", "/run/flok-cdp"]), true);
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
    const session = await plane.get(ref);
    (session as unknown as { plantControlPlaneHelpers: () => void }).plantControlPlaneHelpers();
    (session as unknown as { plantLegacyHelpers: () => void }).plantLegacyHelpers();
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
      ["bash", "-lc", `cat ${CONTROL_PLANE_EXECVP_PATH}`],
      ["python3", "-c", `open('${CONTROL_PLANE_EXECVP_PATH}').read()`],
    ];
    for (const argv of attacks) {
      const r = await p.exec(ref, { argv });
      assert.notEqual(r.exitCode, 0, argv.join(" "));
      assert.doesNotMatch(r.stdout, /import os, sys, json/);
      assert.doesNotMatch(r.stdout, /execvp/);
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
    const lsVarLib = await p.exec(ref, { argv: ["ls", "-a", "/var/lib"] });
    assert.equal(lsVarLib.stdout.split("\n").includes("flok"), false);
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
    const beforeCleanup = await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR);
    assert.equal(beforeCleanup.ok, true);
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
    const gone = await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR);
    assert.equal(gone.ok, false);
    const who = await p.exec(a.providerRef, { argv: ["whoami"] });
    assert.equal(who.stdout.trim(), FLOK_BOT_USER);
  });

  it("wake of a pre-change computer re-runs ensure and still drops to flok", async () => {
    const { plane, p } = provider();
    const a = await p.provision({ birdId: "wake-legacy", flockId: "f" });
    const session = await plane.get(a.providerRef);
    (session as unknown as { plantLegacyHelpers: () => void }).plantLegacyHelpers();
    assert.equal((await session.fsStat(LEGACY_WORKSPACE_HELPER_DIR)).ok, true);
    await p.pause(a.providerRef);
    await p.wake(a.providerRef);
    const who = await p.exec(a.providerRef, { argv: ["whoami"] });
    assert.equal(who.stdout.trim(), FLOK_BOT_USER);
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
    const { p, ref } = await ready();
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
    const marker = await p.filesystem(ref, {
      operation: "read",
      path: `${RUNLOOP_WORKSPACE_ROOT}/.browser/profile/last-url`,
    });
    assert.equal(marker.ok, true);
    assert.equal(marker.data, "https://example.com/");
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
