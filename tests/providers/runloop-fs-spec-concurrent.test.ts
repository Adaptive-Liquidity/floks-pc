/**
 * Concurrent computer_fs writes through SdkRunloopDevbox + a fake box that
 * really executes execvp.py / guest python. Not the memory plane.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createSdkRunloopPlane } from "../../src/lib/computers/providers/runloop-sdk.js";
import { CONTROL_PLANE_DIR } from "../../src/lib/computers/providers/runloop-bot-user.js";
import { RUNLOOP_WORKSPACE_ROOT } from "../../src/lib/computers/providers/runloop-client.js";

const SPEC_RE = /^fs-spec-[0-9a-f-]{36}\.json$/;

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

function sudoWrite(path: string, contents: string, mode = "0600"): void {
  const r = spawnSync("sudo", ["-n", "tee", path], {
    input: contents,
    encoding: "utf8",
    maxBuffer: 8_000_000,
  });
  if (r.status !== 0) {
    throw new Error(`tee ${path}: ${r.stderr}`);
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
    id: "executing-box",
    getInfo: async () => ({
      status: "running",
      metadata: { bird_id: "conc", flock_id: "f" },
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

function prepareHost(): void {
  assert.equal(sudoOk(), true, "passwordless sudo is required for the executing-box test");
  const prep = sudo(
    [
      "set -euo pipefail",
      "mkdir -p /home/user/flok /var/lib/flok",
      "if ! getent group flok >/dev/null; then groupadd -g 1501 flok; fi",
      "if ! id -u flok >/dev/null 2>&1; then useradd -M -u 1501 -g flok -d /home/user/flok -s /bin/bash flok; fi",
      "chown flok:flok /home/user/flok",
      "chmod 1775 /home/user/flok",
      "chown root:root /var/lib/flok",
      "chmod 0700 /var/lib/flok",
      "rm -f /var/lib/flok/fs-spec-*.json /home/user/flok/conc-*.bin",
    ].join(" && "),
  );
  assert.equal(prep.status, 0, prep.stderr);
}

describe("concurrent fsWrite unique spec (executing fake box)", () => {
  it("keeps 8 parallel writes byte-exact and leaves no spec behind", async () => {
    prepareHost();
    const box = createExecutingBox();
    const plane = await createSdkRunloopPlane({
      apiKey: "not-sent",
      blueprint: "bp",
      env: { RUNLOOP_NETWORK_POLICY_ID: "np_test_launch" },
      sdk: {
        devbox: {
          createFromBlueprintName: async () => box,
          createFromSnapshot: async () => box,
          fromId: () => box,
        },
      },
    });
    const session = await plane.create({
      birdId: "conc-spec",
      flockId: "f",
      blueprint: "bp",
      architecture: "x86_64",
      keepAliveSeconds: 60,
      labels: { bird_id: "conc-spec" },
      envVars: {},
    });

    const bodies = Array.from({ length: 8 }, (_, i) => {
      const buf = Buffer.alloc(256 + i * 17, i + 1);
      buf[0] = 0x00;
      buf[1] = 0xff;
      buf.write(`conc-${i}`, 2, "utf8");
      return buf;
    });
    const results = await Promise.all(
      bodies.map((body, i) => session.fsWrite(`${RUNLOOP_WORKSPACE_ROOT}/conc-${i}.bin`, body)),
    );
    for (const [i, r] of results.entries()) {
      assert.equal(r.ok, true, `write ${i}: ${r.ok ? "" : r.errorCode}`);
    }
    for (const [i, body] of bodies.entries()) {
      const disk = spawnSync("sudo", ["-n", "cat", `${RUNLOOP_WORKSPACE_ROOT}/conc-${i}.bin`]);
      assert.equal(disk.status, 0, `cat conc-${i}: ${disk.stderr?.toString()}`);
      assert.equal(Buffer.from(disk.stdout).equals(body), true, `disk conc-${i}`);
    }
    const leftover = sudo(`ls -1 ${CONTROL_PLANE_DIR}`);
    assert.equal(leftover.status, 0, leftover.stderr);
    const specs = leftover.stdout
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => SPEC_RE.test(name));
    assert.deepEqual(specs, []);
    sudo("rm -f /home/user/flok/conc-*.bin");
  });
});
