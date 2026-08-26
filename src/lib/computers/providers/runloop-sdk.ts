/**
 * Official @runloop/api-client adapter (RunloopSDK).
 * Loaded only by RunloopProvider.fromEnv() / live tests — never by unit tests.
 */

import { RunloopSDK } from "@runloop/api-client";
import { posix as pathPosix } from "node:path";
import { ProviderUnavailable } from "../errors.js";
import { assertInsideRoot } from "../path.js";
import type { Action } from "../types.js";
import {
  BROWSER_PROFILE_DIR,
  ENSURE_INTERACTIVE_SH,
  ENSURE_SCRIPT_PATH,
  FIXTURE_HTML,
  FIXTURE_PATH,
  FLOK_DISPLAY,
  FLOK_UI_USER,
  INTERACTIVE_DIR,
  argvAsUiUser,
  chromeLaunchArgv,
  pngDimensions,
  uniqueObsShotPath,
  CHROME_LOG_PATH,
  CDP_AX_HELPER_JS,
  CDP_HELPER_PATH,
  CDP_NODE_BIN,
  CdpAxDumpSchema,
  logCdpAxObserve,
  parseCdpAxHelperStdout,
  sanitizeCdpAxHint,
} from "./runloop-interactive.js";
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
  getInfo(): Promise<{ status: string; metadata?: Record<string, string> }>;
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
    let birdId = "unknown";
    let flockId = "unknown";
    try {
      const info = await box.getInfo();
      const meta = info.metadata ?? {};
      if (meta["flok.bird_id"]) birdId = meta["flok.bird_id"];
      if (meta["flok.flock_id"]) flockId = meta["flok.flock_id"];
    } catch {
      // metadata is diagnostic only
    }
    const session = new SdkRunloopDevbox(box, birdId, flockId);
    await session.ensureWorkspace();
    return session;
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
    const session = new SdkRunloopDevbox(created, params.birdId, params.flockId);
    await session.ensureWorkspace();
    return session;
  }
}

class SdkRunloopDevbox implements RunloopDevboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  bootId = "";
  private interactiveStackUp = false;
  private graphicalStack = false;

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
    await this.lockRootExecutedAssets();
    const boot = await this.box.cmd.exec("cat /proc/sys/kernel/random/boot_id");
    this.bootId = ((await boot.stdout()) ?? "").trim();
  }

  async state(): Promise<RunloopDevboxState> {
    const info = await this.box.getInfo();
    return mapStatus(info.status);
  }

  async suspend(): Promise<void> {
    this.interactiveStackUp = false;
    await this.box.suspend();
    await this.box.awaitSuspended();
  }

  async resume(): Promise<void> {
    this.interactiveStackUp = false;
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
    // Runloop documents optimistic_timeout as "up to 25 seconds. Operation is not killed."
    // cmd.exec still waits for completion; the cap is the first-wait hint, not FLOKS's contract.
    const timeoutSec = Math.max(1, Math.min(25, Math.ceil(req.timeoutMs / 1000)));
    try {
      const result = await this.box.cmd.exec(command, {
        optimistic_timeout: timeoutSec,
      });
      const stdout = await result.stdout();
      const stderr = await result.stderr();
      const timedOut = result.exitCode == null;
      return {
        exitCode: result.exitCode ?? 124,
        stdout,
        stderr,
        timedOut,
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

  async ensureInteractiveStack(): Promise<void> {
    if (this.interactiveStackUp) {
      if (!this.graphicalStack || (await this.xvfbAlive())) return;
      this.interactiveStackUp = false;
    }
    this.requireFs(
      await this.fsMkdir(pathPosix.dirname(ENSURE_SCRIPT_PATH)),
      "ensureInteractiveStack mkdir",
    );
    // Take .flok away from flok-ui before writing helpers root will execute.
    await this.lockRootExecutedAssets();
    this.requireFs(
      await this.fsWrite(ENSURE_SCRIPT_PATH, Buffer.from(ENSURE_INTERACTIVE_SH, "utf8")),
      "ensureInteractiveStack write script",
    );
    this.requireFs(
      await this.fsWrite(FIXTURE_PATH, Buffer.from(FIXTURE_HTML, "utf8")),
      "ensureInteractiveStack write fixture",
    );
    this.requireFs(
      await this.fsWrite(CDP_HELPER_PATH, Buffer.from(CDP_AX_HELPER_JS, "utf8")),
      "ensureInteractiveStack write cdp helper",
    );
    this.requireFs(await this.fsMkdir(BROWSER_PROFILE_DIR), "ensureInteractiveStack mkdir profile");
    await this.lockRootExecutedAssets();
    const r = await this.exec({
      argv: ["bash", ENSURE_SCRIPT_PATH],
      cwd: RUNLOOP_WORKSPACE_ROOT,
      timeoutMs: 30_000,
    });
    if (r.exitCode !== 0) {
      throw new ProviderUnavailable(
        "runloop",
        `ensureInteractiveStack failed: ${r.stderr || r.stdout}`,
      );
    }
    this.graphicalStack = !r.stdout.includes("missing-xvfb");
    this.interactiveStackUp = true;
  }

  async screenshot(): Promise<{
    width: number;
    height: number;
    png: Buffer;
    activeWindow?: string;
  }> {
    const shotPath = uniqueObsShotPath();
    this.requireFs(await this.fsMkdir(pathPosix.dirname(shotPath)), "screenshot dir");
    const shot = await this.exec({
      argv: argvAsUiUser(["import", "-display", FLOK_DISPLAY, "-window", "root", shotPath]),
      cwd: RUNLOOP_WORKSPACE_ROOT,
      env: { DISPLAY: FLOK_DISPLAY },
      timeoutMs: 15_000,
    });
    if (shot.exitCode !== 0) {
      await this.fsDelete(shotPath).catch(() => undefined);
      throw new ProviderUnavailable("runloop", `screenshot failed: ${shot.stderr}`);
    }
    try {
      const file = await this.fsRead(shotPath);
      if (!file.ok || !file.data) {
        throw new ProviderUnavailable("runloop", "screenshot read failed");
      }
      const dims = pngDimensions(file.data);
      if (!dims) {
        throw new ProviderUnavailable("runloop", "screenshot is not a valid PNG");
      }
      let activeWindow: string | undefined;
      const win = await this.exec({
        argv: argvAsUiUser(["xdotool", "getactivewindow", "getwindowname"]),
        cwd: RUNLOOP_WORKSPACE_ROOT,
        env: { DISPLAY: FLOK_DISPLAY },
        timeoutMs: 5_000,
      });
      if (win.exitCode === 0 && win.stdout.trim()) activeWindow = win.stdout.trim();
      const out: { width: number; height: number; png: Buffer; activeWindow?: string } = {
        width: dims.width,
        height: dims.height,
        png: file.data,
      };
      if (activeWindow) out.activeWindow = activeWindow;
      return out;
    } finally {
      await this.fsDelete(shotPath).catch(() => undefined);
    }
  }

  async novncLocalOk(): Promise<boolean> {
    const r = await this.exec({
      argv: [
        "python3",
        "-c",
        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6080/', timeout=2); print('ok')",
      ],
      cwd: RUNLOOP_WORKSPACE_ROOT,
      timeoutMs: 5_000,
    });
    return r.exitCode === 0 && r.stdout.includes("ok");
  }

  async cdpAxDump(): Promise<{ nodes: unknown[] }> {
    await this.ensureInteractiveStack();
    // Same argv the live tester proved via computer_exec: node /home/user/flok/.flok/cdp-ax.mjs
    let r = await this.exec({
      argv: ["node", CDP_HELPER_PATH],
      cwd: RUNLOOP_WORKSPACE_ROOT,
      timeoutMs: 15_000,
    });
    if (r.exitCode === 127) {
      r = await this.exec({
        argv: [CDP_NODE_BIN, CDP_HELPER_PATH],
        cwd: RUNLOOP_WORKSPACE_ROOT,
        timeoutMs: 15_000,
      });
    }
    logCdpAxObserve("helper", {
      exit: r.exitCode,
      timedOut: r.timedOut,
      stdoutLen: r.stdout.length,
      stderrLen: r.stderr.length,
      asUi: false,
    });
    if (r.exitCode !== 0) {
      const hint = sanitizeCdpAxHint(r.stderr || "");
      if (hint) logCdpAxObserve("helper-fail", { exit: r.exitCode, hint });
      throw new ProviderUnavailable(
        "runloop",
        hint ? `cdp ax helper failed (${hint})` : "cdp ax helper failed",
      );
    }
    let parsed: unknown;
    try {
      parsed = parseCdpAxHelperStdout(r.stdout);
    } catch {
      throw new ProviderUnavailable("runloop", "cdp ax helper returned non-JSON");
    }
    const checked = CdpAxDumpSchema.safeParse(parsed);
    if (!checked.success) {
      throw new ProviderUnavailable("runloop", "cdp ax helper dump invalid");
    }
    return { nodes: checked.data.nodes };
  }

  async uiAction(action: Action): Promise<void> {
    const env = { DISPLAY: FLOK_DISPLAY };
    let argv: string[];
    switch (action.type) {
      case "click_coordinates":
        argv = argvAsUiUser([
          "xdotool",
          "mousemove",
          String(action.x),
          String(action.y),
          "click",
          "1",
        ]);
        break;
      case "type":
        argv = argvAsUiUser(["xdotool", "type", "--", action.text ?? ""]);
        break;
      case "key":
        argv = argvAsUiUser(["xdotool", "key", "--", action.key ?? ""]);
        break;
      case "scroll": {
        if (typeof action.x === "number" && action.x !== 0) {
          throw new Error("horizontal scroll unsupported");
        }
        const dy = action.y ?? 0;
        if (!Number.isInteger(dy) || dy === 0) {
          throw new Error("scroll requires non-zero integer y delta");
        }
        const button = dy < 0 ? "4" : "5";
        const n = Math.min(20, Math.abs(dy));
        argv = argvAsUiUser(["xdotool", "click", "--repeat", String(n), button]);
        break;
      }
      case "wait":
        argv = ["sleep", String((action.durationMs ?? 100) / 1000)];
        break;
      case "open_url":
      case "launch_application": {
        const url =
          action.type === "open_url"
            ? (action.url ?? `file://${FIXTURE_PATH}`)
            : `file://${FIXTURE_PATH}`;
        // Detach so exec returning does not SIGHUP Chrome. No --no-sandbox.
        // Launch accepted ≠ Chrome ready; live gate polls readiness separately.
        // runuser drops to flok-ui; python launcher stays the Devbox user (root on DnD).
        // Startup stderr goes to a guest tmp log (not FLOKS audit).
        const chromeCode = [
          "import subprocess,sys",
          `log=open(${JSON.stringify(CHROME_LOG_PATH)},"ab",buffering=0)`,
          "subprocess.Popen(sys.argv[1:], start_new_session=True, stdout=log, stderr=subprocess.STDOUT)",
          "print('launched')",
          "",
        ].join("\n");
        argv = ["python3", "-c", chromeCode, ...chromeLaunchArgv(url)];
        break;
      }
      default:
        throw new Error(`unsupported action ${action.type}`);
    }
    const r = await this.exec({
      argv,
      cwd: RUNLOOP_WORKSPACE_ROOT,
      env,
      timeoutMs: 20_000,
    });
    if (action.type === "open_url" || action.type === "launch_application") {
      // Python Popen returns immediately; non-zero means spawn failed (missing binary, etc.).
      if (r.exitCode !== 0) {
        throw new ProviderUnavailable(
          "runloop",
          r.stderr || r.stdout || "chrome launch failed",
        );
      }
      return;
    }
    if (r.exitCode !== 0 && !r.timedOut) {
      throw new ProviderUnavailable("runloop", r.stderr || `uiAction ${action.type} failed`);
    }
  }

  private requireFs(r: RunloopFsResult, what: string): void {
    if (!r.ok) {
      throw new ProviderUnavailable("runloop", `${what} failed: ${r.errorCode}`);
    }
  }

  /** Cheap Xvfb liveness probe. Full ensure only re-runs if this fails. */
  private async xvfbAlive(): Promise<boolean> {
    try {
      const r = await this.exec({
        argv: ["pgrep", "-u", FLOK_UI_USER, "-f", `Xvfb ${FLOK_DISPLAY}`],
        cwd: RUNLOOP_WORKSPACE_ROOT,
        timeoutMs: 5_000,
      });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Lock root-executed guest helpers via Devbox-root cmd.exec (not execvp.py).
   * flok-ui must not be able to replace anything root later runs.
   */
  private async lockRootExecutedAssets(): Promise<void> {
    const dir = shellSingle(INTERACTIVE_DIR);
    const execvp = shellSingle(EXECVP_PATH);
    const script = shellSingle(ENSURE_SCRIPT_PATH);
    const fixture = shellSingle(FIXTURE_PATH);
    const cdpHelper = shellSingle(CDP_HELPER_PATH);
    const lock = await this.box.cmd.exec(
      [
        `chown root:root ${dir}`,
        `chmod 755 ${dir}`,
        `if [ -f ${execvp} ]; then chown root:root ${execvp} && chmod 755 ${execvp}; fi`,
        `if [ -f ${script} ]; then chown root:root ${script} && chmod 755 ${script}; fi`,
        `if [ -f ${fixture} ]; then chown root:root ${fixture} && chmod 644 ${fixture}; fi`,
        `if [ -f ${cdpHelper} ]; then chown root:root ${cdpHelper} && chmod 755 ${cdpHelper}; fi`,
      ].join(" && "),
    );
    if ((lock.exitCode ?? 1) !== 0) {
      throw new ProviderUnavailable(
        "runloop",
        `lock root-executed assets failed: ${await lock.stderr()}`,
      );
    }
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
