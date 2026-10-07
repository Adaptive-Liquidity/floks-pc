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
  FLOK_DISPLAY,
  FLOK_UI_USER,
  argvAsUiUser,
  chromeLaunchArgv,
  pngDimensions,
  uniqueObsShotPath,
  CHROME_LOG_PATH,
  CHROME_READY_PROBE_PY,
  CDP_AX_HELPER_JS,
  CDP_HELPER_PATH,
  CDP_NODE_BIN,
  CdpAxDumpSchema,
  classifyChromeReadiness,
  formatChromeReadyFailure,
  logCdpAxObserve,
  parseCdpAxHelperStdout,
  parseChromeReadyEvidence,
  sanitizeCdpAxHint,
} from "./runloop-interactive.js";
import { CDP_NAV_HELPER_JS, CDP_NAV_HELPER_PATH } from "./runloop-cdp.js";
import {
  BROWSER_START_URL,
  BrowserNotReady,
  bringManagedBrowserToFront,
  ensureManagedBrowser,
  navigateManagedPage,
  parseNavHelperStdout,
} from "./runloop-browser.js";
import {
  assertNoControlPlaneSecrets,
  LIVE_KEEP_ALIVE_SECONDS,
  RUNLOOP_WORKSPACE_ROOT,
  isIdempotentShutdownError,
  logRunloopLaunch,
  parseRunloopNetworkPolicyId,
  runloopLaunchParameters,
  parseRunloopOnIdle,
  type RunloopControlPlane,
  type RunloopCreateParams,
  type RunloopDevboxSession,
  mapRunloopDevboxStatus,
  type RunloopDevboxState,
  type RunloopExecResult,
  type RunloopFsResult,
} from "./runloop-client.js";
import {
  GUEST_FS_MAX_BYTES,
  GUEST_NOFOLLOW_COPY_PY,
  GUEST_NOFOLLOW_DELETE_PY,
  GUEST_NOFOLLOW_LIST_PY,
  GUEST_NOFOLLOW_MKDIR_PY,
  GUEST_NOFOLLOW_MOVE_PY,
  GUEST_NOFOLLOW_READ_B64_PY,
  GUEST_NOFOLLOW_STAT_PY,
  GUEST_NOFOLLOW_WRITE_STDIN_PY,
  GUEST_PRIV_DELETE_PY,
  GUEST_PRIV_MKDIR_PY,
  GUEST_PRIV_READ_B64_PY,
  bufferFromBase64Stdout,
} from "./runloop-fs.js";
import {
  CONTROL_PLANE_BOT_USER_PATH,
  CONTROL_PLANE_DIR,
  CONTROL_PLANE_EXECVP_PATH,
  ENSURE_BOT_USER_SH,
  FLOK_BOT_USER,
  argvAsBotUser,
  isReservedControlPlanePath,
  uniqueControlPlaneFsSpecPath,
} from "./runloop-bot-user.js";

const EXECVP_PY = [
  "import os, sys, json, base64, re, stat",
  "SPEC_DIR='/var/lib/flok'",
  "SPEC_RE=re.compile(r'^/var/lib/flok/fs-spec-[0-9a-f-]{36}\\.json$')",
  "def load_spec():",
  "    if len(sys.argv) >= 3 and sys.argv[1] == '--spec-file':",
  "        path = sys.argv[2]",
  "        if not SPEC_RE.match(path):",
  "            sys.stderr.write('permission denied'); sys.exit(1)",
  "        name = os.path.basename(path)",
  "        try:",
  "            dirfd = os.open(SPEC_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOCTTY)",
  "        except OSError:",
  "            sys.stderr.write('permission denied'); sys.exit(1)",
  "        try:",
  "            dst = os.fstat(dirfd)",
  "            if dst.st_uid != 0 or (dst.st_mode & 0o077) != 0 or not stat.S_ISDIR(dst.st_mode):",
  "                sys.stderr.write('permission denied'); sys.exit(1)",
  "            try:",
  "                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOCTTY, dir_fd=dirfd)",
  "            except OSError:",
  "                sys.stderr.write('permission denied'); sys.exit(1)",
  "            try:",
  "                st = os.fstat(fd)",
  "                if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_nlink != 1:",
  "                    sys.stderr.write('permission denied'); sys.exit(1)",
  "                os.fchmod(fd, 0o600)",
  "                chunks = []",
  "                while True:",
  "                    b = os.read(fd, 65536)",
  "                    if not b: break",
  "                    chunks.append(b)",
  "                    if sum(len(x) for x in chunks) > 8000000:",
  "                        sys.stderr.write('file too large'); sys.exit(1)",
  "                data = json.loads(b''.join(chunks))",
  "            finally:",
  "                os.close(fd)",
  "            try:",
  "                os.unlink(name, dir_fd=dirfd)",
  "            except FileNotFoundError:",
  "                pass",
  "            except OSError:",
  "                sys.stderr.write('permission denied'); sys.exit(1)",
  "            return data",
  "        finally:",
  "            os.close(dirfd)",
  "    return json.loads(base64.b64decode(sys.argv[1]))",
  "def write_all(fd, data):",
  "    off = 0",
  "    while off < len(data):",
  "        try:",
  "            n = os.write(fd, data[off:])",
  "        except BrokenPipeError:",
  "            return",
  "        if n <= 0: return",
  "        off += n",
  "spec = load_spec()",
  "cwd = spec.get('cwd') or '/home/user/flok'",
  "os.chdir(cwd)",
  "env = os.environ.copy()",
  "for k, v in (spec.get('env') or {}).items():",
  "    env[str(k)] = str(v)",
  "argv = spec['argv']",
  "stdin_b64 = spec.get('stdin_b64')",
  "if stdin_b64 is None:",
  "    os.execvpe(argv[0], argv, env)",
  "r, w = os.pipe()",
  "pid = os.fork()",
  "if pid == 0:",
  "    os.close(w)",
  "    os.dup2(r, 0)",
  "    os.close(r)",
  "    os.execvpe(argv[0], argv, env)",
  "    os._exit(127)",
  "os.close(r)",
  "write_all(w, base64.b64decode(stdin_b64))",
  "os.close(w)",
  "_, status = os.waitpid(pid, 0)",
  "if os.WIFEXITED(status): sys.exit(os.WEXITSTATUS(status))",
  "if os.WIFSIGNALED(status): sys.exit(128 + os.WTERMSIG(status))",
  "sys.exit(1)",
  "",
].join("\n");

const EXECVP_PATH = CONTROL_PLANE_EXECVP_PATH;

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
  keepAlive(): Promise<unknown>;
  snapshotDisk(params?: { name?: string }): Promise<{ id: string }>;
};

type DevboxLauncher = {
  devbox: {
    createFromBlueprintName(blueprint: string, body: Record<string, unknown>): Promise<SdkDevbox>;
    createFromSnapshot(snapshotRef: string, body: Record<string, unknown>): Promise<SdkDevbox>;
    fromId(id: string): SdkDevbox;
  };
};

export async function createSdkRunloopPlane(opts: {
  apiKey: string;
  blueprint: string;
  keepAliveSeconds?: number;
  /** Test stub. Production uses RunloopSDK. */
  sdk?: DevboxLauncher;
  env?: NodeJS.ProcessEnv;
}): Promise<RunloopControlPlane> {
  const env = opts.env ?? process.env;
  const onIdle = parseRunloopOnIdle(env);
  const networkPolicyId = parseRunloopNetworkPolicyId(env);
  const sdk = opts.sdk ?? (new RunloopSDK({ bearerToken: opts.apiKey }) as unknown as DevboxLauncher);
  return new SdkRunloopControlPlane(
    sdk,
    opts.blueprint,
    opts.keepAliveSeconds ?? LIVE_KEEP_ALIVE_SECONDS,
    onIdle,
    networkPolicyId,
  );
}

class SdkRunloopControlPlane implements RunloopControlPlane {
  constructor(
    private readonly sdk: DevboxLauncher,
    private readonly blueprint: string,
    private readonly keepAliveSeconds: number,
    private readonly onIdle: "suspend" | undefined,
    private readonly networkPolicyId: string,
  ) {}

  async create(params: RunloopCreateParams): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const launch = runloopLaunchParameters(
      params,
      this.keepAliveSeconds,
      this.onIdle,
      this.networkPolicyId,
    );
    logRunloopLaunch("create", launch);
    const created = (await this.sdk.devbox.createFromBlueprintName(this.blueprint, {
      name: `flok-${params.birdId}`.slice(0, 48),
      metadata: params.labels,
      launch_parameters: launch,
    })) as unknown as SdkDevbox;
    const session = new SdkRunloopDevbox(created, params.birdId, params.flockId, this.networkPolicyId);
    await session.ensureWorkspace();
    return session;
  }

  async get(id: string): Promise<RunloopDevboxSession> {
    const box = this.sdk.devbox.fromId(id) as unknown as SdkDevbox;
    let birdId = "unknown";
    let flockId = "unknown";
    let reported = "";
    try {
      const info = await box.getInfo();
      reported = info.status;
      const meta = info.metadata ?? {};
      const bird = meta.bird_id || meta["flok.bird_id"];
      const flock = meta.flock_id || meta["flok.flock_id"];
      if (bird) birdId = bird;
      if (flock) flockId = flock;
    } catch {
      // metadata is diagnostic only
    }
    const session = new SdkRunloopDevbox(box, birdId, flockId, this.networkPolicyId);
    if (mapRunloopDevboxStatus(reported) === "running") {
      await session.ensureWorkspace();
    }
    return session;
  }

  async restore(
    snapshotRef: string,
    params: RunloopCreateParams,
  ): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const launch = runloopLaunchParameters(
      params,
      this.keepAliveSeconds,
      this.onIdle,
      this.networkPolicyId,
    );
    logRunloopLaunch("restore", launch);
    const created = (await this.sdk.devbox.createFromSnapshot(snapshotRef, {
      name: `flok-restore-${params.birdId}`.slice(0, 48),
      metadata: params.labels,
      launch_parameters: launch,
    })) as unknown as SdkDevbox;
    const session = new SdkRunloopDevbox(created, params.birdId, params.flockId, this.networkPolicyId);
    await session.ensureWorkspace();
    return session;
  }
}

class SdkRunloopDevbox implements RunloopDevboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  bootId = "";
  interactiveGuest = false;
  private interactiveStackUp = false;
  private graphicalStack = false;
  private botUserReady = false;

  constructor(
    private readonly box: SdkDevbox,
    birdId: string,
    flockId: string,
    private readonly networkPolicyId: string,
  ) {
    this.id = box.id;
    this.birdId = birdId;
    this.flockId = flockId;
  }

  async ensureWorkspace(): Promise<void> {
    await this.ensureControlPlaneDir();
    await this.box.file.write({ file_path: EXECVP_PATH, contents: EXECVP_PY });
    await this.ensureBotUser();
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
    this.botUserReady = false;
    await this.box.suspend();
    await this.box.awaitSuspended();
  }

  async resume(): Promise<void> {
    if (!this.networkPolicyId || this.networkPolicyId.toLowerCase() === "allow_all") {
      throw new Error(
        "RUNLOOP_NETWORK_POLICY_ID is required. Refusing to wake without an explicit network policy.",
      );
    }
    this.interactiveStackUp = false;
    this.botUserReady = false;
    // Runloop SDK 1.28 resume() takes no launch body, so the policy id cannot be
    // sent again here. Create and snapshot restore already sent it. Wake still
    // refuses to run when that id was never configured.
    await this.box.resume();
    await this.box.awaitRunning();
  }

  async shutdown(): Promise<void> {
    try {
      await this.box.shutdown();
    } catch (err) {
      if (isIdempotentShutdownError(err)) return;
      throw err;
    }
  }

  async keepAlive(): Promise<void> {
    await this.box.keepAlive();
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
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(GUEST_NOFOLLOW_STAT_PY, [path]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    const data = JSON.parse(r.stdout) as { isDir: boolean; size: number };
    return { ok: true, data: { path, isDir: data.isDir, size: data.size } };
  }

  async fsList(path: string): Promise<RunloopFsResult<string[]>> {
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(GUEST_NOFOLLOW_LIST_PY, [path]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true, data: JSON.parse(r.stdout) as string[] };
  }

  async fsRead(path: string): Promise<RunloopFsResult<Buffer>> {
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(GUEST_NOFOLLOW_READ_B64_PY, [path]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true, data: bufferFromBase64Stdout(r.stdout) };
  }

  async fsWrite(path: string, body: Buffer): Promise<RunloopFsResult> {
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    if (body.length > GUEST_FS_MAX_BYTES) return { ok: false, errorCode: "FILE_TOO_LARGE" };
    const r = await this.execPython(GUEST_NOFOLLOW_WRITE_STDIN_PY, [path], { stdin: body });
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsMkdir(path: string): Promise<RunloopFsResult> {
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(GUEST_NOFOLLOW_MKDIR_PY, [path]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsDelete(path: string): Promise<RunloopFsResult> {
    if (path === RUNLOOP_WORKSPACE_ROOT) return { ok: false, errorCode: "PATH_ESCAPE" };
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    const r = await this.execPython(GUEST_NOFOLLOW_DELETE_PY, [path]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsMove(from: string, to: string): Promise<RunloopFsResult> {
    const a = this.customerJail(from);
    if (!a.ok) return a;
    const b = this.customerJail(to);
    if (!b.ok) return b;
    const r = await this.execPython(GUEST_NOFOLLOW_MOVE_PY, [from, to]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async fsCopy(from: string, to: string): Promise<RunloopFsResult> {
    const a = this.customerJail(from);
    if (!a.ok) return a;
    const b = this.customerJail(to);
    if (!b.ok) return b;
    const r = await this.execPython(GUEST_NOFOLLOW_COPY_PY, [from, to]);
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  async snapshotDisk(name: string): Promise<string> {
    const snap = await this.box.snapshotDisk({ name });
    return snap.id;
  }

  async ensureInteractiveStack(opts?: { browser?: "strict" | "best-effort" }): Promise<void> {
    if (this.interactiveStackUp) {
      await this.ensureBotUser();
      if (!this.graphicalStack || (await this.xvfbAlive())) {
        await this.finishBrowser(opts);
        return;
      }
      this.interactiveStackUp = false;
    }
    await this.ensureBotUser();
    await this.writeControlPlaneHelpers();
    await this.lockRootExecutedAssets();
    this.requireFs(await this.controlPlaneMkdir(BROWSER_PROFILE_DIR), "ensureInteractiveStack mkdir profile");
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
    let chromeOk = false;
    if (this.graphicalStack) {
      const chrome = await this.exec({
        argv: [
          "bash",
          "-c",
          "command -v google-chrome >/dev/null || command -v google-chrome-stable >/dev/null || command -v chromium >/dev/null",
        ],
        cwd: RUNLOOP_WORKSPACE_ROOT,
        timeoutMs: 5_000,
      });
      chromeOk = chrome.exitCode === 0;
    }
    this.interactiveGuest = this.graphicalStack && chromeOk;
    this.interactiveStackUp = true;
    await this.finishBrowser(opts);
  }

  private async finishBrowser(opts?: { browser?: "strict" | "best-effort" }): Promise<void> {
    const budgetMs = opts?.browser === "best-effort" ? 5_000 : 20_000;
    try {
      await this.ensureBrowser(budgetMs);
    } catch (err) {
      if (opts?.browser === "best-effort") {
        process.stderr.write("flok-browser ensure failed\n");
        return;
      }
      throw err;
    }
  }

  async screenshot(): Promise<{
    width: number;
    height: number;
    png: Buffer;
    activeWindow?: string;
  }> {
    const shotPath = uniqueObsShotPath();
    this.requireFs(await this.controlPlaneMkdir(pathPosix.dirname(shotPath)), "screenshot dir");
    const shot = await this.exec({
      argv: argvAsUiUser(["import", "-display", FLOK_DISPLAY, "-window", "root", `PNG24:${shotPath}`]),
      cwd: RUNLOOP_WORKSPACE_ROOT,
      env: { DISPLAY: FLOK_DISPLAY },
      timeoutMs: 15_000,
    });
    if (shot.exitCode !== 0) {
      await this.controlPlaneDelete(shotPath).catch(() => undefined);
      throw new ProviderUnavailable("runloop", `screenshot failed: ${shot.stderr}`);
    }
    try {
      const file = await this.controlPlaneRead(shotPath);
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
      await this.controlPlaneDelete(shotPath).catch(() => undefined);
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

  private chromePopenArgv(url: string): string[] {
    const chromeCode = [
      "import subprocess,sys",
      `log=open(${JSON.stringify(CHROME_LOG_PATH)},"ab",buffering=0)`,
      "subprocess.Popen(sys.argv[1:], start_new_session=True, stdout=log, stderr=subprocess.STDOUT)",
      "print('launched')",
      "",
    ].join("\n");
    return ["python3", "-c", chromeCode, ...chromeLaunchArgv(url)];
  }

  private async runCdpHelper(): Promise<RunloopExecResult> {
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
    return r;
  }

  private async execGuest(argv: string[], timeoutMs: number): Promise<RunloopExecResult> {
    let r = await this.exec({
      argv,
      cwd: RUNLOOP_WORKSPACE_ROOT,
      env: { DISPLAY: FLOK_DISPLAY },
      timeoutMs,
    });
    if (r.exitCode === 127 && argv[0] === "node") {
      r = await this.exec({
        argv: [CDP_NODE_BIN, ...argv.slice(1)],
        cwd: RUNLOOP_WORKSPACE_ROOT,
        env: { DISPLAY: FLOK_DISPLAY },
        timeoutMs,
      });
    }
    return r;
  }

  /** One flok-ui Chrome at about:blank. A fixture process on 9222 is killed first. */
  private async ensureBrowser(budgetMs = 20_000): Promise<void> {
    if (!this.interactiveGuest) return;
    try {
      await ensureManagedBrowser({
        timeoutMs: budgetMs,
        exec: async (argv) => {
          const isLaunch = argv.includes("python3") && argv.join(" ").includes("Popen");
          const commandBudget = isLaunch ? 20_000 : 8_000;
          const r = await this.execGuest(argv, Math.min(commandBudget, budgetMs));
          return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        },
        launchArgv: this.chromePopenArgv(BROWSER_START_URL),
      });
    } catch (err) {
      if (budgetMs < 20_000) throw err;
      if (err instanceof BrowserNotReady) {
        throw new ProviderUnavailable("runloop", await this.chromeReadyFailure());
      }
      if (err instanceof ProviderUnavailable) throw err;
      throw new ProviderUnavailable(
        "runloop",
        err instanceof Error ? err.message : "chrome launch failed",
      );
    }
  }

  private async chromeReadyFailure(): Promise<string> {
    try {
      const probe = await this.exec({
        argv: ["python3", "-c", CHROME_READY_PROBE_PY],
        cwd: RUNLOOP_WORKSPACE_ROOT,
        timeoutMs: 15_000,
      });
      const evidence = parseChromeReadyEvidence(probe.stdout);
      return formatChromeReadyFailure(classifyChromeReadiness(evidence, { timedOut: true }), evidence);
    } catch {
      return "chrome did not answer on 127.0.0.1:9222";
    }
  }

  async browserUrl(): Promise<string | undefined> {
    if (!this.interactiveGuest) return undefined;
    const r = await this.execGuest(["node", CDP_NAV_HELPER_PATH, "--href"], 10_000);
    if (r.exitCode !== 0) return undefined;
    const parsed = parseNavHelperStdout(r.stdout);
    if (!parsed?.ok || !parsed.href) return undefined;
    return parsed.href;
  }

  async cdpAxDump(): Promise<{
    nodes: unknown[];
    viewportOrigin?: { x: number; y: number };
    devicePixelRatio?: number;
  }> {
    let r = await this.runCdpHelper();
    const refused = /ECONNREFUSED|9222/.test(r.stderr);
    if (r.exitCode !== 0 && refused) {
      await this.ensureBrowser();
      r = await this.runCdpHelper();
    }
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
    const dump: {
      nodes: unknown[];
      viewportOrigin?: { x: number; y: number };
      devicePixelRatio?: number;
    } = { nodes: checked.data.nodes };
    if (checked.data.viewportOrigin) dump.viewportOrigin = checked.data.viewportOrigin;
    if (checked.data.devicePixelRatio !== undefined) dump.devicePixelRatio = checked.data.devicePixelRatio;
    return dump;
  }

  async uiAction(action: Action): Promise<{ finalUrl?: string } | void> {
    if (action.type === "open_url") {
      const url = action.url ?? "";
      return navigateManagedPage({
        url,
        ensureBrowser: () => this.ensureBrowser(),
        navArgv: ["node", CDP_NAV_HELPER_PATH, url],
        exec: async (argv) => {
          const r = await this.execGuest(argv, 20_000);
          return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        },
      });
    }
    if (action.type === "launch_application") {
      await bringManagedBrowserToFront({
        ensureBrowser: () => this.ensureBrowser(),
        frontArgv: ["node", CDP_NAV_HELPER_PATH, "--front"],
        exec: async (argv) => {
          const r = await this.execGuest(argv, 15_000);
          return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        },
      });
      return;
    }
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
      default:
        throw new Error(`unsupported action ${action.type}`);
    }
    const r = await this.exec({
      argv,
      cwd: RUNLOOP_WORKSPACE_ROOT,
      env,
      timeoutMs: 20_000,
    });
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

  async ensureBotUser(): Promise<void> {
    if (this.botUserReady) return;
    await this.ensureControlPlaneDir();
    await this.box.file.write({
      file_path: CONTROL_PLANE_BOT_USER_PATH,
      contents: ENSURE_BOT_USER_SH,
    });
    const script = shellSingle(CONTROL_PLANE_BOT_USER_PATH);
    const result = await this.box.cmd.exec(
      [
        `if [ -f ${script} ] && [ ! -L ${script} ]; then chown -h root:root ${script} && chmod 0700 ${script}; fi`,
        `bash ${script}`,
      ].join(" && "),
    );
    if ((result.exitCode ?? 1) !== 0) {
      const detail = sanitizeCdpAxHint((await result.stderr()) || (await result.stdout()), 180);
      throw new ProviderUnavailable(
        "runloop",
        detail
          ? `could not create unprivileged bot user '${FLOK_BOT_USER}' (${detail})`
          : `could not create unprivileged bot user '${FLOK_BOT_USER}' on this computer`,
      );
    }
    this.botUserReady = true;
  }

  private async ensureControlPlaneDir(): Promise<void> {
    const dir = shellSingle(CONTROL_PLANE_DIR);
    const mkdir = await this.box.cmd.exec(
      `mkdir -p ${dir} && if [ -L ${dir} ]; then echo refusing symlink ${dir} >&2; exit 1; fi && chown -h root:root ${dir} && chmod 0700 ${dir}`,
    );
    if ((mkdir.exitCode ?? 1) !== 0) {
      throw new ProviderUnavailable(
        "runloop",
        `control-plane helper dir failed: ${await mkdir.stderr()}`,
      );
    }
  }

  private async writeControlPlaneHelpers(): Promise<void> {
    await this.ensureControlPlaneDir();
    await this.box.file.write({
      file_path: ENSURE_SCRIPT_PATH,
      contents: ENSURE_INTERACTIVE_SH,
    });
    await this.box.file.write({
      file_path: CDP_HELPER_PATH,
      contents: CDP_AX_HELPER_JS,
    });
    await this.box.file.write({
      file_path: CDP_NAV_HELPER_PATH,
      contents: CDP_NAV_HELPER_JS,
    });
    await this.box.file.write({
      file_path: EXECVP_PATH,
      contents: EXECVP_PY,
    });
  }

  /**
   * Lock root-executed guest helpers via Devbox-root cmd.exec (not execvp.py).
   * The bot user and flok-ui must not replace anything root later runs.
   */
  private async lockRootExecutedAssets(): Promise<void> {
    const dir = shellSingle(CONTROL_PLANE_DIR);
    const execvp = shellSingle(EXECVP_PATH);
    const script = shellSingle(ENSURE_SCRIPT_PATH);
    const botUser = shellSingle(CONTROL_PLANE_BOT_USER_PATH);
    const cdpHelper = shellSingle(CDP_HELPER_PATH);
    const cdpNav = shellSingle(CDP_NAV_HELPER_PATH);
    const leftover = shellSingle(`${RUNLOOP_WORKSPACE_ROOT}/.flok`);
    const lock = await this.box.cmd.exec(
      [
        `mkdir -p ${dir}`,
        `if [ -L ${dir} ]; then echo refusing symlink ${dir} >&2; exit 1; fi`,
        `chown -h root:root ${dir}`,
        `chmod 0700 ${dir}`,
        `if [ -f ${execvp} ] && [ ! -L ${execvp} ]; then chown -h root:root ${execvp} && chmod 0700 ${execvp}; fi`,
        `if [ -f ${script} ] && [ ! -L ${script} ]; then chown -h root:root ${script} && chmod 0700 ${script}; fi`,
        `if [ -f ${botUser} ] && [ ! -L ${botUser} ]; then chown -h root:root ${botUser} && chmod 0700 ${botUser}; fi`,
        `if [ -f ${cdpHelper} ] && [ ! -L ${cdpHelper} ]; then chown -h root:root ${cdpHelper} && chmod 0700 ${cdpHelper}; fi`,
        `if [ -f ${cdpNav} ] && [ ! -L ${cdpNav} ]; then chown -h root:root ${cdpNav} && chmod 0700 ${cdpNav}; fi`,
        `rm -rf ${leftover}`,
      ].join(" && "),
    );
    if ((lock.exitCode ?? 1) !== 0) {
      throw new ProviderUnavailable(
        "runloop",
        `lock root-executed assets failed: ${await lock.stderr()}`,
      );
    }
  }

  /**
   * Lexical jail only. Customer fs never realpath-then-act as another user.
   * Guest Python opens with O_NOFOLLOW as `flok`.
   */
  private customerJail(path: string): RunloopFsResult {
    try {
      assertInsideRoot(path, RUNLOOP_WORKSPACE_ROOT);
    } catch {
      return { ok: false, errorCode: "PATH_ESCAPE" };
    }
    if (isReservedControlPlanePath(path)) {
      return { ok: false, errorCode: "PERMISSION_DENIED" };
    }
    return { ok: true };
  }

  /** Platform-only mkdir (Chrome profile / screenshot dir). Not computer_fs. */
  private async controlPlaneMkdir(path: string): Promise<RunloopFsResult> {
    const r = await this.execPython(GUEST_PRIV_MKDIR_PY, [path], { privileged: true });
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  /** Platform-only read of a file the graphical stack just wrote. Not computer_fs. */
  private async controlPlaneRead(path: string): Promise<RunloopFsResult<Buffer>> {
    const r = await this.execPython(GUEST_PRIV_READ_B64_PY, [path], { privileged: true });
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true, data: bufferFromBase64Stdout(r.stdout) };
  }

  private async controlPlaneDelete(path: string): Promise<RunloopFsResult> {
    const r = await this.execPython(GUEST_PRIV_DELETE_PY, [path], { privileged: true });
    if (r.exitCode !== 0) return { ok: false, errorCode: classifyFs(r.stderr) };
    return { ok: true };
  }

  private async execPython(
    code: string,
    argv: string[],
    opts?: { privileged?: boolean; stdin?: Buffer },
  ): Promise<RunloopExecResult> {
    const guestArgv = ["python3", "-c", code, ...argv];
    const payload: { argv: string[]; cwd: string; stdin_b64?: string } = {
      argv: opts?.privileged === true ? guestArgv : argvAsBotUser(guestArgv),
      cwd: RUNLOOP_WORKSPACE_ROOT,
    };
    if (opts?.stdin !== undefined) {
      payload.stdin_b64 = opts.stdin.toString("base64");
      return this.execViaSpecFile(payload);
    }
    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    return this.execViaArgvSpec(b64);
  }

  /**
   * Small specs stay on argv. Write bodies never do — Linux MAX_ARG_STRLEN
   * is 128 KiB and a double-base64 body hits E2BIG near 72 KB.
   */
  private async execViaArgvSpec(b64: string): Promise<RunloopExecResult> {
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

  /** Control-plane staging only. Customer computer_fs paths never use box.file. */
  private async execViaSpecFile(payload: {
    argv: string[];
    cwd: string;
    stdin_b64?: string;
  }): Promise<RunloopExecResult> {
    const specPath = uniqueControlPlaneFsSpecPath();
    await this.box.file.write({
      file_path: specPath,
      contents: JSON.stringify(payload),
    });
    const spec = shellSingle(specPath);
    const execvp = shellSingle(EXECVP_PATH);
    try {
      const result = await this.box.cmd.exec(`python3 ${execvp} --spec-file ${spec}`, {
        optimistic_timeout: 15,
      });
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
    } finally {
      await this.box.cmd.exec(`rm -f ${spec}`);
    }
  }
}

function mapStatus(status: string): RunloopDevboxState {
  return mapRunloopDevboxStatus(status);
}

function classifyFs(err: unknown): string {
  const s = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (s.includes("file too large")) {
    return "FILE_TOO_LARGE";
  }
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
