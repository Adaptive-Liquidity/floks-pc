/**
 * In-memory Runloop control plane for unit/contract tests.
 * Zero network. Two sessions have independent filesystems, boot IDs,
 * and lifecycle. Suspend preserves disk, not RAM.
 *
 * Customer computer_fs is modeled as `flok` + O_NOFOLLOW: reserved paths,
 * foreign owners, and symlinks fail closed. Control-plane writes (profile
 * markers, helpers) use a separate path the bot cannot reach.
 */

import { randomBytes } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { PathEscape, ProviderUnavailable } from "../errors.js";
import { assertInsideRoot } from "../path.js";
import type { Action } from "../types.js";
import {
  BROWSER_PROFILE_DIR,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  INTERACTIVE_DIR,
} from "./runloop-interactive.js";
import {
  BOT_BROWSER_DIR,
  CONTROL_PLANE_CDP_AX_PATH,
  CONTROL_PLANE_CDP_NAV_PATH,
  CONTROL_PLANE_CDP_RUNTIME_DIR,
  CONTROL_PLANE_DIR,
  CONTROL_PLANE_EXECVP_PATH,
  FLOK_BOT_UID,
  FLOK_BOT_USER,
  LEGACY_WORKSPACE_HELPER_DIR,
  argvTouchesReserved,
  filterBotVisibleListing,
  isReservedControlPlanePath,
  unwrapBotArgv,
} from "./runloop-bot-user.js";
import {
  assertNoControlPlaneSecrets,
  RUNLOOP_WORKSPACE_ROOT,
  type RunloopControlPlane,
  type RunloopCreateParams,
  type RunloopDevboxSession,
  type RunloopDevboxState,
  type RunloopExecResult,
  type RunloopFsResult,
} from "./runloop-client.js";

export type MemoryOwner = "flok" | "flok-ui" | "root";

export interface MemoryChownCall {
  path: string;
  user: string;
  noDeref: boolean;
  recursive: boolean;
}

interface MemFile {
  isDir: boolean;
  content: Buffer;
  owner: MemoryOwner;
  mode: number;
  symlinkTo?: string;
}

function memDir(owner: MemoryOwner, mode = 0o775): MemFile {
  return { isDir: true, content: Buffer.alloc(0), owner, mode };
}

function memFile(content: Buffer, owner: MemoryOwner, mode = 0o644): MemFile {
  return { isDir: false, content: Buffer.from(content), owner, mode };
}

function memSymlink(target: string, owner: MemoryOwner): MemFile {
  return {
    isDir: false,
    content: Buffer.from(target, "utf8"),
    owner,
    mode: 0o777,
    symlinkTo: target,
  };
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

export class MemoryRunloopControlPlane implements RunloopControlPlane {
  private readonly sessions = new Map<string, MemoryRunloopDevbox>();
  private readonly snapshots = new Map<string, Map<string, MemFile>>();
  /** Test hook: next create/restore session fails its first ensureInteractiveStack. */
  failNextEnsure = false;
  lastCreatedId: string | null = null;

  async create(params: RunloopCreateParams): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const id = newId("rlbox");
    const session = new MemoryRunloopDevbox(id, params, this.snapshots);
    if (this.failNextEnsure) {
      session.failEnsureOnce = true;
      this.failNextEnsure = false;
    }
    this.lastCreatedId = id;
    this.sessions.set(id, session);
    return session;
  }

  async get(id: string): Promise<RunloopDevboxSession> {
    const s = this.sessions.get(id);
    if (!s || s.destroyed) {
      throw new Error(`runloop devbox ${id} not found`);
    }
    if (this.failNextEnsure) {
      s.failEnsureOnce = true;
      this.failNextEnsure = false;
    }
    return s;
  }

  async restore(
    snapshotRef: string,
    params: RunloopCreateParams,
  ): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const snap = this.snapshots.get(snapshotRef);
    if (!snap) throw new Error(`snapshot ${snapshotRef} not found`);
    const session = (await this.create(params)) as MemoryRunloopDevbox;
    session.replaceFs(cloneFs(snap));
    return session;
  }
}

class MemoryRunloopDevbox implements RunloopDevboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  readonly bootId: string;
  interactiveGuest = true;
  destroyed = false;
  /** How many times ensureInteractiveStack actually (re)started. */
  stackStarts = 0;
  failEnsureOnce = false;
  /** Test hook: Chrome never answers. Best-effort wake continues; strict observe fails. */
  failBrowserEnsure = false;
  suspendCalls = 0;
  /** How many times ensureBotUser actually ran. Idempotent guest setup. */
  botUserEnsureCount = 0;
  botUserReady = false;
  /** Test hook: live-shaped CDP dump. Null keeps the memory-plane fail-closed throw. */
  cdpAxDumpResult: { nodes: unknown[] } | null = null;
  /** Root chown calls recorded for planted-symlink / no-follow assertions. */
  chownLog: MemoryChownCall[] = [];
  /** How many times a jailed path was swapped to a symlink before the act. */
  raceFired = 0;
  refusedBrowserSymlink = false;
  private pendingRace: { path: string; target: string } | null = null;
  private stackUp = false;
  private current: RunloopDevboxState = "running";
  private fs: Map<string, MemFile>;
  private readonly snapshots: Map<string, Map<string, MemFile>>;

  constructor(
    id: string,
    params: RunloopCreateParams,
    snapshots: Map<string, Map<string, MemFile>>,
  ) {
    this.id = id;
    this.birdId = params.birdId;
    this.flockId = params.flockId;
    this.bootId = randomBytes(16).toString("hex");
    this.snapshots = snapshots;
    this.fs = new Map();
    this.fs.set(RUNLOOP_WORKSPACE_ROOT, memDir(FLOK_BOT_USER));
  }

  replaceFs(fs: Map<string, MemFile>): void {
    this.fs = fs;
  }

  async state(): Promise<RunloopDevboxState> {
    return this.current;
  }

  async suspend(): Promise<void> {
    this.assertAlive();
    this.suspendCalls += 1;
    this.current = "paused";
    this.stackUp = false;
    this.botUserReady = false;
  }

  async resume(): Promise<void> {
    this.assertAlive();
    this.botUserReady = false;
    if (this.current === "paused" || this.current === "stopped") {
      this.current = "running";
    }
  }

  async shutdown(): Promise<void> {
    this.current = "deleted";
    this.destroyed = true;
  }

  async keepAlive(): Promise<void> {
    return;
  }

  async exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<RunloopExecResult> {
    this.assertRunning();
    assertNoControlPlaneSecrets(req.env);
    const unwrapped = unwrapBotArgv(req.argv);
    const asBot = unwrapped.user === FLOK_BOT_USER;
    const env = { ...(req.env ?? {}), ...unwrapped.env };
    return this.runGuestArgv(unwrapped.argv, req.cwd, env, req.timeoutMs, asBot);
  }

  private async runGuestArgv(
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number,
    asBot: boolean,
  ): Promise<RunloopExecResult> {
    if (asBot && isReservedControlPlanePath(cwd)) {
      return denied("Permission denied");
    }
    if (asBot && argvTouchesReserved(argv)) {
      return denied("Permission denied");
    }
    if (
      (argv[0] === "bash" || argv[0] === "sh") &&
      (argv[1] === "-lc" || argv[1] === "-c") &&
      typeof argv[2] === "string"
    ) {
      return this.runGuestArgv(tokenizeSimpleShell(argv[2]), cwd, env, timeoutMs, asBot);
    }
    const cmd = argv[0] ?? "";

    if (asBot && (cmd === "sudo" || cmd === "su" || cmd === "pkexec")) {
      return {
        exitCode: 1,
        stdout: "",
        stderr:
          cmd === "sudo"
            ? "sudo: a password is required\n"
            : `${cmd}: Authentication failure\n`,
        timedOut: false,
      };
    }
    if (cmd === "whoami" || (cmd === "id" && argv[1] === "-un")) {
      return {
        exitCode: 0,
        stdout: `${asBot ? FLOK_BOT_USER : "root"}\n`,
        stderr: "",
        timedOut: false,
      };
    }
    if (cmd === "id" && argv[1] === "-u") {
      const who = argv[2];
      let uid = asBot ? String(FLOK_BOT_UID) : "0";
      if (who === "flok-ui") uid = "1500";
      else if (who === FLOK_BOT_USER) uid = String(FLOK_BOT_UID);
      else if (who === "root") uid = "0";
      return {
        exitCode: 0,
        stdout: `${uid}\n`,
        stderr: "",
        timedOut: false,
      };
    }
    if (cmd === "id") {
      return {
        exitCode: 0,
        stdout: asBot
          ? `uid=${FLOK_BOT_UID}(${FLOK_BOT_USER}) gid=${FLOK_BOT_UID}(${FLOK_BOT_USER}) groups=${FLOK_BOT_UID}(${FLOK_BOT_USER})\n`
          : "uid=0(root) gid=0(root) groups=0(root)\n",
        stderr: "",
        timedOut: false,
      };
    }
    if (cmd === "true") {
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    }
    if (cmd === "echo") {
      return { exitCode: 0, stdout: `${argv.slice(1).join(" ")}\n`, stderr: "", timedOut: false };
    }
    if (cmd === "cat" && argv[1] === "/proc/sys/kernel/random/boot_id") {
      return { exitCode: 0, stdout: `${this.bootId}\n`, stderr: "", timedOut: false };
    }
    if (cmd === "cat") {
      const target = resolveArgPath(argv[1], cwd);
      if (asBot && this.botBlockedPath(target)) return denied("Permission denied");
      const file = this.fs.get(target);
      if (!file || file.isDir || file.symlinkTo) {
        return { exitCode: 1, stdout: "", stderr: "cat: not found\n", timedOut: false };
      }
      return { exitCode: 0, stdout: file.content.toString("utf8"), stderr: "", timedOut: false };
    }
    if (cmd === "pwd") {
      return { exitCode: 0, stdout: `${cwd}\n`, stderr: "", timedOut: false };
    }
    if (cmd === "printenv") {
      const key = argv[1];
      const val = key ? (env[key] ?? "") : "";
      return { exitCode: 0, stdout: val, stderr: "", timedOut: false };
    }
    if (cmd === "ls") {
      return this.simLs(argv, cwd, asBot);
    }
    if (cmd === "find") {
      return this.simFind(argv, cwd, asBot);
    }
    if (cmd === "rm" || cmd === "chmod" || cmd === "chown" || cmd === "touch" || cmd === "mkdir") {
      if (asBot && argvTouchesReserved(argv)) return denied("Permission denied");
      const target = argv.find((a) => a.startsWith("/") || (!a.startsWith("-") && a !== cmd));
      if (target && asBot && this.botBlockedPath(resolveArgPath(target, cwd))) {
        return denied("Permission denied");
      }
      return { exitCode: 1, stdout: "", stderr: `${cmd}: not permitted\n`, timedOut: false };
    }
    if (cmd === "sleep") {
      const sec = Number(argv[1] ?? "0");
      if (sec * 1000 > timeoutMs) {
        return { exitCode: 124, stdout: "", stderr: "timed out", timedOut: true };
      }
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    }

    return {
      exitCode: 127,
      stdout: "",
      stderr: `memory-runloop: unsupported argv ${JSON.stringify(argv)}`,
      timedOut: false,
    };
  }

  async fsStat(
    path: string,
  ): Promise<RunloopFsResult<{ path: string; isDir: boolean; size: number }>> {
    this.assertRunning();
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    this.fireRace(path);
    const file = this.botOpen(path);
    if (!file.ok) return file;
    return { ok: true, data: { path, isDir: file.file.isDir, size: file.file.content.length } };
  }

  async fsList(path: string): Promise<RunloopFsResult<string[]>> {
    this.assertRunning();
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    this.fireRace(path);
    const dir = this.botOpen(path);
    if (!dir.ok) return dir;
    if (!dir.file.isDir) return { ok: false, errorCode: "NOT_FOUND" };
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const children = new Set<string>();
    for (const key of this.fs.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) children.add(name);
    }
    return { ok: true, data: filterBotVisibleListing(path, [...children].sort()) };
  }

  async fsRead(path: string): Promise<RunloopFsResult<Buffer>> {
    this.assertRunning();
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    this.fireRace(path);
    const file = this.botOpen(path);
    if (!file.ok) return file;
    if (file.file.isDir) return { ok: false, errorCode: "NOT_FOUND" };
    return { ok: true, data: Buffer.from(file.file.content) };
  }

  async fsWrite(path: string, body: Buffer): Promise<RunloopFsResult> {
    this.assertRunning();
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    this.fireRace(path);
    const parents = this.ensureBotParents(path);
    if (!parents.ok) return parents;
    const existing = this.fs.get(path);
    if (existing?.symlinkTo) return { ok: false, errorCode: "PERMISSION_DENIED" };
    if (existing && existing.owner !== FLOK_BOT_USER) {
      return { ok: false, errorCode: "PERMISSION_DENIED" };
    }
    this.fs.set(path, memFile(body, FLOK_BOT_USER));
    return { ok: true };
  }

  async fsMkdir(path: string): Promise<RunloopFsResult> {
    this.assertRunning();
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    this.fireRace(path);
    return this.mkdirAsBot(path);
  }

  async fsDelete(path: string): Promise<RunloopFsResult> {
    this.assertRunning();
    if (path === RUNLOOP_WORKSPACE_ROOT) return { ok: false, errorCode: "PATH_ESCAPE" };
    const jailed = this.customerJail(path);
    if (!jailed.ok) return jailed;
    this.fireRace(path);
    const existing = this.fs.get(path);
    if (!existing) return { ok: false, errorCode: "NOT_FOUND" };
    if (existing.symlinkTo) {
      this.fs.delete(path);
      return { ok: true };
    }
    const opened = this.botOpen(path);
    if (!opened.ok) return opened;
    for (const key of [...this.fs.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) {
        const child = this.fs.get(key);
        if (child?.symlinkTo) {
          this.fs.delete(key);
          continue;
        }
        if (child && child.owner !== FLOK_BOT_USER) {
          return { ok: false, errorCode: "PERMISSION_DENIED" };
        }
        this.fs.delete(key);
      }
    }
    return { ok: true };
  }

  async fsMove(from: string, to: string): Promise<RunloopFsResult> {
    this.assertRunning();
    const a = this.customerJail(from);
    if (!a.ok) return a;
    const b = this.customerJail(to);
    if (!b.ok) return b;
    this.fireRace(from);
    this.fireRace(to);
    const src = this.botOpen(from);
    if (!src.ok) return src;
    const destExisting = this.fs.get(to);
    if (destExisting?.symlinkTo) return { ok: false, errorCode: "PERMISSION_DENIED" };
    const parents = this.ensureBotParents(to);
    if (!parents.ok) return parents;
    this.fs.set(to, {
      isDir: src.file.isDir,
      content: Buffer.from(src.file.content),
      owner: FLOK_BOT_USER,
      mode: src.file.mode,
    });
    this.fs.delete(from);
    return { ok: true };
  }

  async fsCopy(from: string, to: string): Promise<RunloopFsResult> {
    this.assertRunning();
    const a = this.customerJail(from);
    if (!a.ok) return a;
    const b = this.customerJail(to);
    if (!b.ok) return b;
    this.fireRace(from);
    this.fireRace(to);
    const src = this.botOpen(from);
    if (!src.ok) return src;
    if (src.file.isDir) return { ok: false, errorCode: "IO_ERROR" };
    const destExisting = this.fs.get(to);
    if (destExisting?.symlinkTo) return { ok: false, errorCode: "PERMISSION_DENIED" };
    const parents = this.ensureBotParents(to);
    if (!parents.ok) return parents;
    this.fs.set(to, memFile(src.file.content, FLOK_BOT_USER));
    return { ok: true };
  }

  async snapshotDisk(name: string): Promise<string> {
    this.assertAlive();
    this.snapshots.set(name, cloneFs(this.fs));
    return name;
  }

  async ensureBotUser(): Promise<void> {
    this.assertAlive();
    this.botUserEnsureCount += 1;
    if (this.botUserReady) return;
    for (const key of [...this.fs.keys()]) {
      if (key === LEGACY_WORKSPACE_HELPER_DIR || key.startsWith(`${LEGACY_WORKSPACE_HELPER_DIR}/`)) {
        this.fs.delete(key);
      }
    }
    this.controlPlaneMkdir(CONTROL_PLANE_DIR, "root", 0o700);
    this.controlPlaneMkdir(INTERACTIVE_DIR, "root", 0o700);
    this.simulateEnsureChown();
    this.botUserReady = true;
  }

  async ensureInteractiveStack(opts?: { browser?: "strict" | "best-effort" }): Promise<void> {
    this.assertAlive();
    if (this.failEnsureOnce) {
      this.failEnsureOnce = false;
      throw new Error("ensureInteractiveStack failed");
    }
    if (this.current !== "running") {
      throw new Error(`runloop devbox ${this.id} is ${this.current}`);
    }
    await this.ensureBotUser();
    if (!this.stackUp) {
      this.stackStarts += 1;
      this.stackUp = true;
    }
    this.controlPlaneMkdir(BROWSER_PROFILE_DIR, "flok-ui", 0o700);
    this.controlPlaneMkdir(INTERACTIVE_DIR, "root", 0o700);
    if (this.failBrowserEnsure) {
      if (opts?.browser === "best-effort") {
        process.stderr.write("flok-browser ensure failed\n");
        return;
      }
      throw new ProviderUnavailable("runloop", "chrome did not answer on 127.0.0.1:9222");
    }
  }

  async screenshot(): Promise<{
    width: number;
    height: number;
    png: Buffer;
    activeWindow?: string;
  }> {
    this.assertRunning();
    if (!this.stackUp) await this.ensureInteractiveStack();
    return {
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      png: MIN_PNG,
      activeWindow: `flok-${this.birdId}`,
    };
  }

  async novncLocalOk(): Promise<boolean> {
    this.assertRunning();
    return this.stackUp;
  }

  async cdpAxDump(): Promise<{ nodes: unknown[] }> {
    this.assertRunning();
    if (this.cdpAxDumpResult) return this.cdpAxDumpResult;
    throw new Error("guest Chrome CDP is not available on the memory plane");
  }

  async uiAction(action: Action): Promise<{ finalUrl?: string } | void> {
    this.assertRunning();
    if (!this.stackUp) await this.ensureInteractiveStack();
    if (action.type === "click_element") {
      throw new Error("click_element unsupported until accessibility addressing exists");
    }
    if (action.type === "open_url" && action.url) {
      this.controlPlaneMkdir(BROWSER_PROFILE_DIR, "flok-ui", 0o700);
      this.controlPlaneWrite(
        `${BROWSER_PROFILE_DIR}/last-url`,
        Buffer.from(action.url, "utf8"),
        "flok-ui",
        0o600,
      );
    }
    if (action.type === "launch_application") {
      this.controlPlaneMkdir(BROWSER_PROFILE_DIR, "flok-ui", 0o700);
      this.controlPlaneWrite(
        `${BROWSER_PROFILE_DIR}/launched`,
        Buffer.from("1", "utf8"),
        "flok-ui",
        0o600,
      );
    }
  }

  /** Test helper: simulate suspend discarding RAM daemons. */
  markStackDown(): void {
    this.stackUp = false;
    this.botUserReady = false;
  }

  /** Test helper: leftover workspace helpers from a pre-change computer. */
  plantLegacyHelpers(): void {
    this.fs.set(LEGACY_WORKSPACE_HELPER_DIR, memDir("root", 0o700));
    this.fs.set(
      `${LEGACY_WORKSPACE_HELPER_DIR}/execvp.py`,
      memFile(Buffer.from("import os, sys, json\nlegacy-execvp", "utf8"), "root", 0o700),
    );
    this.fs.set(
      `${LEGACY_WORKSPACE_HELPER_DIR}/cdp-ax.mjs`,
      memFile(Buffer.from("legacy-cdp", "utf8"), "root", 0o700),
    );
    this.botUserReady = false;
  }

  /** Test helper: root-owned helpers that must stay invisible to the bot user. */
  plantControlPlaneHelpers(): void {
    this.fs.set(CONTROL_PLANE_DIR, memDir("root", 0o700));
    this.fs.set(
      CONTROL_PLANE_EXECVP_PATH,
      memFile(Buffer.from("import os, sys, json\nexecvp", "utf8"), "root", 0o700),
    );
    this.fs.set(
      CONTROL_PLANE_CDP_AX_PATH,
      memFile(Buffer.from("cdp-ax-helper", "utf8"), "root", 0o700),
    );
    this.fs.set(
      CONTROL_PLANE_CDP_NAV_PATH,
      memFile(Buffer.from("cdp-nav-helper", "utf8"), "root", 0o700),
    );
    this.fs.set(CONTROL_PLANE_CDP_RUNTIME_DIR, memDir("root", 0o700));
    this.fs.set(
      `${CONTROL_PLANE_CDP_RUNTIME_DIR}/ws`,
      memFile(Buffer.from("cdp-ws", "utf8"), "root", 0o700),
    );
  }

  /** flok-ui Chrome profile + cookies. Not a customer file view. */
  plantBrowserCookies(): void {
    this.controlPlaneMkdir(BROWSER_PROFILE_DIR, "flok-ui", 0o700);
    this.controlPlaneWrite(
      `${BROWSER_PROFILE_DIR}/Cookies`,
      Buffer.from("chrome-cookie-secret", "utf8"),
      "flok-ui",
      0o600,
    );
    this.controlPlaneWrite(
      `${BOT_BROWSER_DIR}/Local State`,
      Buffer.from("browser-local-state", "utf8"),
      "flok-ui",
      0o600,
    );
  }

  plantOwnedFile(path: string, content: Buffer | string, owner: MemoryOwner, mode = 0o644): void {
    this.controlPlaneMkdir(pathPosix.dirname(path), owner);
    this.fs.set(
      path,
      memFile(typeof content === "string" ? Buffer.from(content, "utf8") : content, owner, mode),
    );
  }

  plantSymlink(path: string, target: string, owner: MemoryOwner = FLOK_BOT_USER): void {
    this.controlPlaneMkdir(pathPosix.dirname(path), owner);
    this.fs.set(path, memSymlink(target, owner));
  }

  /**
   * After the next customer jail check of `path`, replace it with a symlink.
   * Models check-then-act TOCTOU without ever acting as a different user.
   */
  armSymlinkRace(path: string, target: string): void {
    this.pendingRace = { path, target };
  }

  peekRead(path: string): Buffer | null {
    const file = this.fs.get(path);
    if (!file || file.isDir) return null;
    return Buffer.from(file.content);
  }

  peekList(path: string): string[] {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const children = new Set<string>();
    for (const key of this.fs.keys()) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length).split("/")[0];
      if (name) children.add(name);
    }
    return [...children].sort();
  }

  peekOwner(path: string): MemoryOwner | undefined {
    return this.fs.get(path)?.owner;
  }

  peekIsSymlink(path: string): boolean {
    return Boolean(this.fs.get(path)?.symlinkTo);
  }

  peekExists(path: string): boolean {
    return this.fs.has(path);
  }

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

  private fireRace(path: string): void {
    if (!this.pendingRace || this.pendingRace.path !== path) return;
    this.fs.set(path, memSymlink(this.pendingRace.target, FLOK_BOT_USER));
    this.pendingRace = null;
    this.raceFired += 1;
  }

  private botOpen(path: string): { ok: true; file: MemFile } | { ok: false; errorCode: string } {
    if (this.parentHasSymlink(path)) return { ok: false, errorCode: "PERMISSION_DENIED" };
    const file = this.fs.get(path);
    if (!file) return { ok: false, errorCode: "NOT_FOUND" };
    if (file.symlinkTo) return { ok: false, errorCode: "PERMISSION_DENIED" };
    if (file.owner !== FLOK_BOT_USER) return { ok: false, errorCode: "PERMISSION_DENIED" };
    return { ok: true, file };
  }

  private parentHasSymlink(path: string): boolean {
    let cur = pathPosix.dirname(path);
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const st = this.fs.get(cur);
      if (st?.symlinkTo) return true;
      const next = pathPosix.dirname(cur);
      if (next === cur) break;
      cur = next;
    }
    return false;
  }

  private botBlockedPath(path: string): boolean {
    if (isReservedControlPlanePath(path)) return true;
    const file = this.fs.get(path);
    if (file?.symlinkTo) return true;
    if (file && file.owner !== FLOK_BOT_USER) return true;
    return this.parentHasSymlink(path);
  }

  private ensureBotParents(path: string): RunloopFsResult {
    const parent = pathPosix.dirname(path);
    if (parent === path) return { ok: true };
    return this.mkdirAsBot(parent);
  }

  private mkdirAsBot(path: string): RunloopFsResult {
    const parts = path.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      const existing = this.fs.get(acc);
      if (existing?.symlinkTo) return { ok: false, errorCode: "PERMISSION_DENIED" };
      if (existing && !existing.isDir) return { ok: false, errorCode: "IO_ERROR" };
      const ancestorOfWorkspace =
        acc === RUNLOOP_WORKSPACE_ROOT || RUNLOOP_WORKSPACE_ROOT.startsWith(`${acc}/`);
      if (existing && existing.owner !== FLOK_BOT_USER && !ancestorOfWorkspace) {
        return { ok: false, errorCode: "PERMISSION_DENIED" };
      }
      if (!existing) this.fs.set(acc, memDir(FLOK_BOT_USER));
    }
    return { ok: true };
  }

  private controlPlaneMkdir(path: string, owner: MemoryOwner, mode = 0o775): void {
    const parts = path.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      const existing = this.fs.get(acc);
      if (existing?.symlinkTo) {
        throw new Error(`control-plane mkdir refuses symlink ${acc}`);
      }
      if (existing && !existing.isDir) {
        throw new Error(`control-plane mkdir: not a directory ${acc}`);
      }
      if (!existing) this.fs.set(acc, memDir(owner, mode));
    }
  }

  private controlPlaneWrite(
    path: string,
    body: Buffer,
    owner: MemoryOwner,
    mode = 0o644,
  ): void {
    const parent = pathPosix.dirname(path);
    if (parent !== path) this.controlPlaneMkdir(parent, owner);
    const existing = this.fs.get(path);
    if (existing?.symlinkTo) {
      throw new Error(`control-plane write refuses symlink ${path}`);
    }
    this.fs.set(path, memFile(body, owner, mode));
  }

  /**
   * Lazy ensure chown: -h / --no-dereference, -P with -R.
   * Never follows a planted symlink into /etc or /var/lib/flok.
   */
  private simulateEnsureChown(): void {
    const ws = this.fs.get(RUNLOOP_WORKSPACE_ROOT);
    if (ws?.symlinkTo) return;
    if (ws) {
      ws.owner = FLOK_BOT_USER;
      this.recordChown(RUNLOOP_WORKSPACE_ROOT, FLOK_BOT_USER, false);
    }
    const prefix = `${RUNLOOP_WORKSPACE_ROOT}/`;
    for (const [key, file] of this.fs) {
      if (!key.startsWith(prefix)) continue;
      const top = key.slice(prefix.length).split("/")[0];
      if (top === ".browser" || top === ".flok") continue;
      this.recordChown(key, FLOK_BOT_USER, true);
      if (file.symlinkTo) continue;
      file.owner = FLOK_BOT_USER;
    }
    const browser = this.fs.get(BOT_BROWSER_DIR);
    if (browser?.symlinkTo) {
      this.refusedBrowserSymlink = true;
      return;
    }
    if (browser) {
      this.recordChown(BOT_BROWSER_DIR, "flok-ui", true);
      browser.owner = "flok-ui";
      for (const [key, file] of this.fs) {
        if (key === BOT_BROWSER_DIR || !key.startsWith(`${BOT_BROWSER_DIR}/`)) continue;
        this.recordChown(key, "flok-ui", true);
        if (file.symlinkTo) continue;
        file.owner = "flok-ui";
      }
    }
  }

  private recordChown(path: string, user: string, recursive: boolean): void {
    this.chownLog.push({ path, user, noDeref: true, recursive });
  }

  private simLs(argv: string[], cwd: string, asBot: boolean): RunloopExecResult {
    const flags = argv.filter((a) => a.startsWith("-"));
    const paths = argv.slice(1).filter((a) => !a.startsWith("-"));
    const target = resolveArgPath(paths[0] ?? cwd, cwd);
    if (asBot && this.botBlockedPath(target)) return denied("Permission denied");
    const dir = this.fs.get(target);
    if (!dir || !dir.isDir || dir.symlinkTo) {
      return { exitCode: 2, stdout: "", stderr: "ls: cannot access\n", timedOut: false };
    }
    const prefix = target.endsWith("/") ? target : `${target}/`;
    const children = new Set<string>();
    for (const key of this.fs.keys()) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length).split("/")[0];
      if (name) children.add(name);
    }
    let names = asBot ? filterBotVisibleListing(target, [...children].sort()) : [...children].sort();
    if (!flags.some((f) => f.includes("a"))) {
      names = names.filter((name) => !name.startsWith("."));
    }
    return {
      exitCode: 0,
      stdout: names.length ? `${names.join("\n")}\n` : "",
      stderr: "",
      timedOut: false,
    };
  }

  private simFind(argv: string[], cwd: string, asBot: boolean): RunloopExecResult {
    const startRaw = findStartPath(argv);
    const start = resolveArgPath(startRaw, cwd);
    if (asBot && this.botBlockedPath(start)) return denied("Permission denied");
    const nameIdx = argv.indexOf("-name");
    const namePat = nameIdx >= 0 ? argv[nameIdx + 1] : undefined;
    const hits: string[] = [];
    for (const key of this.fs.keys()) {
      if (asBot && isReservedControlPlanePath(key)) continue;
      if (start !== "/" && key !== start && !key.startsWith(`${start}/`)) continue;
      if (start === "/" && isReservedControlPlanePath(key)) continue;
      const file = this.fs.get(key);
      if (asBot && file?.symlinkTo) continue;
      const base = key.slice(key.lastIndexOf("/") + 1);
      if (namePat && base !== namePat) continue;
      hits.push(key);
    }
    return {
      exitCode: 0,
      stdout: hits.length ? `${hits.sort().join("\n")}\n` : "",
      stderr: "",
      timedOut: false,
    };
  }

  private assertAlive(): void {
    if (this.destroyed || this.current === "deleted") {
      throw new Error(`runloop devbox ${this.id} destroyed`);
    }
  }

  private assertRunning(): void {
    this.assertAlive();
    if (this.current !== "running") {
      throw new Error(`runloop devbox ${this.id} is ${this.current}`);
    }
  }
}

function cloneFs(src: Map<string, MemFile>): Map<string, MemFile> {
  const out = new Map<string, MemFile>();
  for (const [k, v] of src) {
    const copy: MemFile = {
      isDir: v.isDir,
      content: Buffer.from(v.content),
      owner: v.owner,
      mode: v.mode,
    };
    if (v.symlinkTo !== undefined) copy.symlinkTo = v.symlinkTo;
    out.set(k, copy);
  }
  return out;
}

function resolveArgPath(userPath: string | undefined, cwd: string): string {
  if (!userPath) throw new PathEscape("");
  if (userPath.startsWith("/")) return pathPosix.normalize(userPath);
  return pathPosix.normalize(pathPosix.join(cwd, userPath));
}

function denied(message: string): RunloopExecResult {
  return { exitCode: 1, stdout: "", stderr: `${message}\n`, timedOut: false };
}

function tokenizeSimpleShell(command: string): string[] {
  const trimmed = command.trim();
  if (trimmed) {
    const out: string[] = [];
    let current = "";
    let quote: '"' | "'" | null = null;
    for (const ch of trimmed) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (/\s/.test(ch)) {
        if (current) out.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    if (current) out.push(current);
    return out;
  }
  return [];
}

function findStartPath(argv: string[]): string {
  let skipValue = false;
  for (const arg of argv.slice(1)) {
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (arg === "-name" || arg === "-path" || arg === "-type") {
      skipValue = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return "/";
}

/** 1×1 PNG. Memory-plane screenshot stub — not a real display capture. */
const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
