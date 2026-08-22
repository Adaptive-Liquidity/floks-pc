/**
 * Official @runloop/api-client adapter (RunloopSDK).
 * Loaded only by RunloopProvider.fromEnv() / live tests — never by unit tests.
 */

import { RunloopSDK } from "@runloop/api-client";
import { posix as pathPosix } from "node:path";
import { ProviderUnavailable } from "../errors.js";
import { assertInsideRoot } from "../path.js";
import {
  assertNoControlPlaneSecrets,
  DEFAULT_RUNLOOP_ARCH,
  LIVE_KEEP_ALIVE_SECONDS,
  RUNLOOP_WORKSPACE_ROOT,
  type RunloopControlPlane,
  type RunloopCreateParams,
  type RunloopDevboxSession,
  type RunloopDevboxState,
  type RunloopExecResult,
  type RunloopFsResult,
} from "./runloop-client.js";

const EXECVP_PY = [
  "import os, sys, json, base64",
  "spec = json.loads(base64.b64decode(sys.argv[1]))",
  "cwd = spec.get('cwd') or '/home/user/flok'",
  "os.chdir(cwd)",
  "env = os.environ.copy()",
  "for k, v in (spec.get('env') or {}).items():",
  "    env[str(k)] = str(v)",
  "argv = spec['argv']",
  "os.execvpe(argv[0], argv, env)",
  "",
].join("\n");

const EXECVP_PATH = `${RUNLOOP_WORKSPACE_ROOT}/.flok/execvp.py`;

type SdkDevbox = {
  id: string;
  getInfo(): Promise<{ status: string }>;
  cmd: {
    exec(
      command: string,
      params?: { optimistic_timeout?: number | null },
    ): Promise<{
      exitCode: number | null;
      stdout(n?: number): Promise<string>;
      stderr(n?: number): Promise<string>;
    }>;
  };
  file: {
    read(params: { file_path: string }): Promise<string>;
    write(params: { file_path: string; contents: string }): Promise<unknown>;
    download(params: { path: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    upload(params: { path: string; file: File }): Promise<unknown>;
  };
  suspend(): Promise<unknown>;
  awaitSuspended(): Promise<unknown>;
  resume(): Promise<unknown>;
  awaitRunning(): Promise<unknown>;
  shutdown(): Promise<unknown>;
  snapshotDisk(params?: { name?: string }): Promise<{ id: string }>;
};

export async function createSdkRunloopPlane(opts: {
  apiKey: string;
  blueprint: string;
  keepAliveSeconds?: number;
}): Promise<RunloopControlPlane> {
  const sdk = new RunloopSDK({ bearerToken: opts.apiKey });
  return new SdkRunloopControlPlane(
    sdk,
    opts.blueprint,
    opts.keepAliveSeconds ?? LIVE_KEEP_ALIVE_SECONDS,
  );
}

class SdkRunloopControlPlane implements RunloopControlPlane {
  constructor(
    private readonly sdk: RunloopSDK,
    private readonly blueprint: string,
    private readonly keepAliveSeconds: number,
  ) {}

  async create(params: RunloopCreateParams): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const launch = {
      architecture: params.architecture || DEFAULT_RUNLOOP_ARCH,
      keep_alive_time_seconds: params.keepAliveSeconds || this.keepAliveSeconds,
    };
    const created = (await this.sdk.devbox.createFromBlueprintName(this.blueprint, {
      name: `flok-${params.birdId}`.slice(0, 48),
      metadata: params.labels,
      launch_parameters: launch,
    })) as unknown as SdkDevbox;
    const session = new SdkRunloopDevbox(created, params.birdId, params.flockId);
    await session.ensureWorkspace();
    return session;
  }

  async get(id: string): Promise<RunloopDevboxSession> {
    const box = this.sdk.devbox.fromId(id) as unknown as SdkDevbox;
    return new SdkRunloopDevbox(box, "unknown", "unknown");
  }

  async restore(
    snapshotRef: string,
    params: RunloopCreateParams,
  ): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const launch = {
      architecture: params.architecture || DEFAULT_RUNLOOP_ARCH,
      keep_alive_time_seconds: params.keepAliveSeconds || this.keepAliveSeconds,
    };
    const created = (await this.sdk.devbox.createFromSnapshot(snapshotRef, {
      name: `flok-restore-${params.birdId}`.slice(0, 48),
      metadata: params.labels,
      launch_parameters: launch,
    })) as unknown as SdkDevbox;
    return new SdkRunloopDevbox(created, params.birdId, params.flockId);
  }
}

class SdkRunloopDevbox implements RunloopDevboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  bootId = "";

  constructor(
    private readonly box: SdkDevbox,
    birdId: string,
    flockId: string,
  ) {
    this.id = box.id;
    this.birdId = birdId;
    this.flockId = flockId;
  }

  async ensureWorkspace(): Promise<void> {
    await this.box.cmd.exec(`mkdir -p ${shellSingle(RUNLOOP_WORKSPACE_ROOT + "/.flok")}`);
    await this.box.file.write({ file_path: EXECVP_PATH, contents: EXECVP_PY });
    const boot = await this.box.cmd.exec("cat /proc/sys/kernel/random/boot_id");
    this.bootId = ((await boot.stdout()) ?? "").trim();
  }

  async state(): Promise<RunloopDevboxState> {
    const info = await this.box.getInfo();
    return mapStatus(info.status);
  }

  async suspend(): Promise<void> {
    await this.box.suspend();
    await this.box.awaitSuspended();
  }

  async resume(): Promise<void> {
    await this.box.resume();
    await this.box.awaitRunning();
  }

  async shutdown(): Promise<void> {
    try {
      await this.box.shutdown();
    } catch {
      // idempotent
    }
  }

  async exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<RunloopExecResult> {
    assertNoControlPlaneSecrets(req.env);
    const payload: { argv: string[]; cwd: string; env?: Record<string, string> } = {
      argv: req.argv,
      cwd: req.cwd,
    };
    if (req.env) payload.env = req.env;
    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    const command = `python3 ${shellSingle(EXECVP_PATH)} ${b64}`;
    const timeoutSec = Math.max(1, Math.min(25, Math.ceil(req.timeoutMs / 1000)));
    try {
      const result = await this.box.cmd.exec(command, {
        optimistic_timeout: timeoutSec,
      });
      const stdout = await result.stdout();
      const stderr = await result.stderr();
      const exitCode = result.exitCode ?? 1;
      return {
        exitCode,
        stdout,
        stderr,
        timedOut: false,
      };
    } catch (e) {
      throw new ProviderUnavailable(
        "runloop",
        e instanceof Error ? e.message : "exec failed",
      );
    }
  }

  async fsStat(
    path: string,
  ): Promise<RunloopFsResult<{ path: string; isDir: boolean; size: number }>> {
    const jailed = await this.enforceResolved(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(
      `import os,json,sys; p=sys.argv[1]; st=os.stat(p); print(json.dumps({"isDir":os.path.isdir(p),"size":st.st_size}))`,
      [path],
    );
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    const data = JSON.parse(r.stdout) as { isDir: boolean; size: number };
    return { ok: true, data: { path, isDir: data.isDir, size: data.size } };
  }

  async fsList(path: string): Promise<RunloopFsResult<string[]>> {
    const jailed = await this.enforceResolved(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(
      `import os,json,sys; p=sys.argv[1]; print(json.dumps(sorted(os.listdir(p))))`,
      [path],
    );
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true, data: JSON.parse(r.stdout) as string[] };
  }

  async fsRead(path: string): Promise<RunloopFsResult<Buffer>> {
    const jailed = await this.enforceResolved(path);
    if (!jailed.ok) return jailed;
    try {
      const resp = await this.box.file.download({ path });
      const buf = Buffer.from(await resp.arrayBuffer());
      return { ok: true, data: buf };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsWrite(path: string, body: Buffer): Promise<RunloopFsResult> {
    const jailed = await this.enforceResolved(path);
    if (!jailed.ok) return jailed;
    try {
      const parent = pathPosix.dirname(path);
      await this.fsMkdir(parent);
      await this.box.file.upload({
        path,
        file: new File([body], pathPosix.basename(path)),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsMkdir(path: string): Promise<RunloopFsResult> {
    const jailed = await this.enforceResolved(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(`import os,sys; os.makedirs(sys.argv[1], exist_ok=True)`, [
      path,
    ]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsDelete(path: string): Promise<RunloopFsResult> {
    if (path === RUNLOOP_WORKSPACE_ROOT) return { ok: false, errorCode: "PATH_ESCAPE" };
    const jailed = await this.enforceResolved(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(
      `import os,shutil,sys,pathlib; p=sys.argv[1];\n` +
        `p_=pathlib.Path(p);\n` +
        `shutil.rmtree(p) if p_.is_dir() else os.remove(p)`,
      [path],
    );
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsMove(from: string, to: string): Promise<RunloopFsResult> {
    const a = await this.enforceResolved(from);
    if (!a.ok) return a;
    const b = await this.enforceResolved(to);
    if (!b.ok) return b;
    const r = await this.execPython(`import os,sys; os.rename(sys.argv[1], sys.argv[2])`, [
      from,
      to,
    ]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsCopy(from: string, to: string): Promise<RunloopFsResult> {
    const a = await this.enforceResolved(from);
    if (!a.ok) return a;
    const b = await this.enforceResolved(to);
    if (!b.ok) return b;
    const r = await this.execPython(
      `import shutil,sys; shutil.copy2(sys.argv[1], sys.argv[2])`,
      [from, to],
    );
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async snapshotDisk(name: string): Promise<string> {
    const snap = await this.box.snapshotDisk({ name });
    return snap.id;
  }

  private async enforceResolved(path: string): Promise<RunloopFsResult> {
    try {
      assertInsideRoot(path, RUNLOOP_WORKSPACE_ROOT);
    } catch {
      return { ok: false, errorCode: "PATH_ESCAPE" };
    }
    const r = await this.execPython(
      `import os,sys; print(os.path.realpath(sys.argv[1]))`,
      [path],
    );
    if (r.exitCode !== 0) {
      // path may not exist yet (mkdir/write); lexical jail already applied
      return { ok: true };
    }
    const resolved = r.stdout.trim();
    try {
      assertInsideRoot(resolved, RUNLOOP_WORKSPACE_ROOT);
      return { ok: true };
    } catch {
      return { ok: false, errorCode: "PATH_ESCAPE" };
    }
  }

  private async execPython(code: string, argv: string[]): Promise<RunloopExecResult> {
    const payload = {
      argv: ["python3", "-c", code, ...argv],
      cwd: RUNLOOP_WORKSPACE_ROOT,
    };
    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    const command = `python3 ${shellSingle(EXECVP_PATH)} ${b64}`;
    try {
      const result = await this.box.cmd.exec(command, { optimistic_timeout: 15 });
      return {
        exitCode: result.exitCode ?? 1,
        stdout: await result.stdout(),
        stderr: await result.stderr(),
        timedOut: false,
      };
    } catch (e) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        timedOut: false,
      };
    }
  }
}

function mapStatus(status: string): RunloopDevboxState {
  switch (status) {
    case "running":
      return "running";
    case "suspended":
    case "suspending":
      return "paused";
    case "shutdown":
      return "stopped";
    case "failure":
      return "error";
    case "provisioning":
    case "initializing":
    case "queued":
    case "scheduled":
    case "resuming":
      return "provisioning";
    default:
      return "error";
  }
}

function classifyFs(err: unknown): string {
  const s = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (s.includes("permission") || s.includes("denied") || s.includes("read-only")) {
    return "PERMISSION_DENIED";
  }
  if (s.includes("not found") || s.includes("no such") || s.includes("404")) {
    return "NOT_FOUND";
  }
  return "IO_ERROR";
}

/** Quote a path that contains no single quotes (workspace paths we control). */
function shellSingle(p: string): string {
  if (p.includes("'")) throw new Error("refusing path with quote");
  return `'${p}'`;
}
