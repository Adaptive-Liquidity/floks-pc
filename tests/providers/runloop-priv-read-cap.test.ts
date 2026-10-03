/**
 * Privileged screenshot reads vs customer computer_fs cap.
 * Executing fake box — not the memory plane, not live Runloop.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createSdkRunloopPlane } from "../../src/lib/computers/providers/runloop-sdk.js";
import { CONTROL_PLANE_DIR, UI_BROWSER_DIR } from "../../src/lib/computers/providers/runloop-bot-user.js";
import { RUNLOOP_WORKSPACE_ROOT } from "../../src/lib/computers/providers/runloop-client.js";
import type { RunloopFsResult } from "../../src/lib/computers/providers/runloop-client.js";

function sudoOk(): boolean {
  return spawnSync("sudo", ["-n", "true"]).status === 0;
}

function sudo(cmd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("sudo", ["-n", "bash", "-lc", cmd], {
    encoding: "utf8",
    maxBuffer: 8_000_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function sudoWrite(path: string, contents: Buffer | string, mode = "0600"): void {
  const r = spawnSync("sudo", ["-n", "tee", path], {
    input: contents,
    maxBuffer: 8_000_000,
  });
  if (r.status !== 0) {
    throw new Error(`tee ${path}: ${r.stderr?.toString()}`);
  }
  const chmod = spawnSync("sudo", ["-n", "chmod", mode, path], { encoding: "utf8" });
  if (chmod.status !== 0) throw new Error(`chmod ${path}: ${chmod.stderr}`);
  const chown = spawnSync("sudo", ["-n", "chown", "root:root", path], { encoding: "utf8" });
  if (chown.status !== 0) throw new Error(`chown ${path}: ${chown.stderr}`);
}

function execAsync(command: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("sudo", ["-n", "bash", "-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

function createExecutingBox() {
  return {
    id: "priv-read-box",
    getInfo: async () => ({
      status: "running",
      metadata: { bird_id: "priv", flock_id: "f" },
    }),
    cmd: {
      exec: async (command: string) => {
        if (command.includes("ensure-bot-user.sh") || command.includes("ensure-interactive.sh")) {
          return {
            exitCode: 0,
            stdout: async () => "ok skipped-ensure\n",
            stderr: async () => "",
          };
        }
        const result = await execAsync(command);
        return {
          exitCode: result.exitCode,
          stdout: async () => result.stdout,
          stderr: async () => result.stderr,
        };
      },
    },
    file: {
      read: async () => "",
      write: async (params: { file_path: string; contents: string }) => {
        if (!params.file_path.startsWith(`${CONTROL_PLANE_DIR}/`)) {
          throw new Error(`refusing file.write outside ${CONTROL_PLANE_DIR}`);
        }
        sudoWrite(params.file_path, params.contents, "0600");
      },
      download: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      upload: async () => undefined,
    },
    suspend: async () => undefined,
    awaitSuspended: async () => undefined,
    resume: async () => undefined,
    awaitRunning: async () => undefined,
    shutdown: async () => undefined,
    keepAlive: async () => undefined,
    snapshotDisk: async () => ({ id: "snap" }),
  };
}

type PrivilegedReader = {
  controlPlaneRead: (path: string) => Promise<RunloopFsResult<Buffer>>;
  fsRead: (path: string) => Promise<RunloopFsResult<Buffer>>;
};

describe("privileged vs customer read cap (executing fake box)", () => {
  it("controlPlaneRead of 1.4 MB under .flok-browser succeeds; customer 1_000_001 is FILE_TOO_LARGE", async () => {
    assert.equal(sudoOk(), true, "passwordless sudo is required");
    const prep = sudo(
      [
        "set -euo pipefail",
        "mkdir -p /home/user/flok /var/lib/flok /home/flok-ui/.flok-browser",
        "if ! getent group flok >/dev/null; then groupadd -g 1501 flok; fi",
        "if ! id -u flok >/dev/null 2>&1; then useradd -M -u 1501 -g flok -d /home/user/flok -s /bin/bash flok; fi",
        "chown flok:flok /home/user/flok",
        "chmod 1775 /home/user/flok",
        "chown root:root /var/lib/flok /home/flok-ui",
        "chmod 0700 /var/lib/flok",
        "chmod 0755 /home/flok-ui",
        "chmod 0700 /home/flok-ui/.flok-browser",
        "rm -f /home/user/flok/already-huge.bin /home/flok-ui/.flok-browser/obs-cap-test.bin",
      ].join(" && "),
    );
    assert.equal(prep.status, 0, prep.stderr);

    const box = createExecutingBox();
    const plane = await createSdkRunloopPlane({
      apiKey: "not-sent",
      blueprint: "bp",
      sdk: {
        devbox: {
          createFromBlueprintName: async () => box,
          createFromSnapshot: async () => box,
          fromId: () => box,
        },
      },
    });
    const session = (await plane.create({
      birdId: "priv-cap",
      flockId: "f",
      blueprint: "bp",
      architecture: "x86_64",
      keepAliveSeconds: 60,
      labels: { bird_id: "priv-cap" },
      envVars: {},
    })) as unknown as PrivilegedReader;

    const shotPath = `${UI_BROWSER_DIR}/obs-cap-test.bin`;
    const shot = Buffer.alloc(1_400_000, 0x61);
    shot[0] = 0x89;
    shot[1] = 0x50;
    shot[shot.length - 1] = 0x0a;
    sudoWrite(shotPath, shot, "0644");
    const priv = await session.controlPlaneRead(shotPath);
    assert.equal(priv.ok, true, priv.ok ? "" : priv.errorCode);
    assert.ok(priv.ok && priv.data);
    assert.equal(priv.data.equals(shot), true);

    const overPath = `${RUNLOOP_WORKSPACE_ROOT}/already-huge.bin`;
    const over = Buffer.alloc(1_000_001, 0x45);
    const planted = spawnSync("sudo", ["-n", "tee", overPath], {
      input: over,
      maxBuffer: 8_000_000,
    });
    assert.equal(planted.status, 0, planted.stderr?.toString());
    const own = sudo(`chown flok:flok ${overPath} && chmod 644 ${overPath}`);
    assert.equal(own.status, 0, own.stderr);
    const customer = await session.fsRead(overPath);
    assert.equal(customer.ok, false);
    assert.equal(customer.errorCode, "FILE_TOO_LARGE");

    sudo(`rm -f ${shotPath} ${overPath}`);
  });
});
