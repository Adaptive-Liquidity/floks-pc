/**
 * In-memory Runloop control plane for unit/contract tests.
 * Zero network. Two sessions have independent filesystems, boot IDs,
 * and lifecycle. Suspend preserves disk, not RAM.
 */

import { randomBytes } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { PathEscape, ProviderUnavailable } from "../errors.js";
import type { Action } from "../types.js";
import {
  BROWSER_PROFILE_DIR,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  INTERACTIVE_DIR,
} from "./runloop-interactive.js";
import {
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

interface MemFile {
  isDir: boolean;
  content: Buffer;
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
    this.fs.set(RUNLOOP_WORKSPACE_ROOT, { isDir: true, content: Buffer.alloc(0) });
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
      if (asBot && isReservedControlPlanePath(target)) return denied("Permission denied");
      const file = this.fs.get(target);
      if (!file || file.isDir) {
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
      if (target && asBot && isReservedControlPlanePath(resolveArgPath(target, cwd))) {
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
    const file = this.fs.get(path);
    if (!file) return { ok: false, errorCode: "NOT_FOUND" };
    return { ok: true, data: { path, isDir: file.isDir, size: file.content.length } };
  }

  async fsList(path: string): Promise<RunloopFsResult<string[]>> {
    this.assertRunning();
    const dir = this.fs.get(path);
    if (!dir) return { ok: false, errorCode: "NOT_FOUND" };
    if (!dir.isDir) return { ok: false, errorCode: "NOT_FOUND" };
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const children = new Set<string>();
    for (const key of this.fs.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) children.add(name);
    }
    return { ok: true, data: [...children].sort() };
  }

  async fsRead(path: string): Promise<RunloopFsResult<Buffer>> {
    this.assertRunning();
    const file = this.fs.get(path);
    if (!file || file.isDir) return { ok: false, errorCode: "NOT_FOUND" };
    return { ok: true, data: file.content };
  }

  async fsWrite(path: string, body: Buffer): Promise<RunloopFsResult> {
    this.assertRunning();
    const parent = pathPosix.dirname(path);
    if (parent !== path && !this.fs.get(parent)?.isDir) {
      return { ok: false, errorCode: "NOT_FOUND" };
    }
    this.fs.set(path, { isDir: false, content: Buffer.from(body) });
    return { ok: true };
  }

  async fsMkdir(path: string): Promise<RunloopFsResult> {
    this.assertRunning();
    const parts = path.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      const existing = this.fs.get(acc);
      if (existing && !existing.isDir) return { ok: false, errorCode: "IO_ERROR" };
      if (!existing) this.fs.set(acc, { isDir: true, content: Buffer.alloc(0) });
    }
    return { ok: true };
  }

  async fsDelete(path: string): Promise<RunloopFsResult> {
    this.assertRunning();
    if (path === RUNLOOP_WORKSPACE_ROOT) return { ok: false, errorCode: "PATH_ESCAPE" };
    if (!this.fs.has(path)) return { ok: false, errorCode: "NOT_FOUND" };
    for (const key of [...this.fs.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.fs.delete(key);
    }
    return { ok: true };
  }

  async fsMove(from: string, to: string): Promise<RunloopFsResult> {
    this.assertRunning();
    const src = this.fs.get(from);
    if (!src) return { ok: false, errorCode: "NOT_FOUND" };
    this.fs.set(to, { isDir: src.isDir, content: Buffer.from(src.content) });
    this.fs.delete(from);
    return { ok: true };
  }

  async fsCopy(from: string, to: string): Promise<RunloopFsResult> {
    this.assertRunning();
    const src = this.fs.get(from);
    if (!src) return { ok: false, errorCode: "NOT_FOUND" };
    this.fs.set(to, { isDir: src.isDir, content: Buffer.from(src.content) });
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
    await this.fsMkdir(CONTROL_PLANE_DIR);
    await this.fsMkdir(INTERACTIVE_DIR);
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
    await this.fsMkdir(BROWSER_PROFILE_DIR);
    await this.fsMkdir(INTERACTIVE_DIR);
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
      await this.fsMkdir(BROWSER_PROFILE_DIR);
      await this.fsWrite(
        `${BROWSER_PROFILE_DIR}/last-url`,
        Buffer.from(action.url, "utf8"),
      );
    }
    if (action.type === "launch_application") {
      await this.fsMkdir(BROWSER_PROFILE_DIR);
      await this.fsWrite(
        `${BROWSER_PROFILE_DIR}/launched`,
        Buffer.from("1", "utf8"),
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
    this.fs.set(LEGACY_WORKSPACE_HELPER_DIR, { isDir: true, content: Buffer.alloc(0) });
    this.fs.set(`${LEGACY_WORKSPACE_HELPER_DIR}/execvp.py`, {
      isDir: false,
      content: Buffer.from("import os, sys, json\nlegacy-execvp", "utf8"),
    });
    this.fs.set(`${LEGACY_WORKSPACE_HELPER_DIR}/cdp-ax.mjs`, {
      isDir: false,
      content: Buffer.from("legacy-cdp", "utf8"),
    });
    this.botUserReady = false;
  }

  /** Test helper: root-owned helpers that must stay invisible to the bot user. */
  plantControlPlaneHelpers(): void {
    this.fs.set(CONTROL_PLANE_DIR, { isDir: true, content: Buffer.alloc(0) });
    this.fs.set(CONTROL_PLANE_EXECVP_PATH, {
      isDir: false,
      content: Buffer.from("import os, sys, json\nexecvp", "utf8"),
    });
    this.fs.set(CONTROL_PLANE_CDP_AX_PATH, {
      isDir: false,
      content: Buffer.from("cdp-ax-helper", "utf8"),
    });
    this.fs.set(CONTROL_PLANE_CDP_NAV_PATH, {
      isDir: false,
      content: Buffer.from("cdp-nav-helper", "utf8"),
    });
    this.fs.set(CONTROL_PLANE_CDP_RUNTIME_DIR, { isDir: true, content: Buffer.alloc(0) });
    this.fs.set(`${CONTROL_PLANE_CDP_RUNTIME_DIR}/ws`, {
      isDir: false,
      content: Buffer.from("cdp-ws", "utf8"),
    });
  }

  private simLs(argv: string[], cwd: string, asBot: boolean): RunloopExecResult {
    const flags = argv.filter((a) => a.startsWith("-"));
    const paths = argv.slice(1).filter((a) => !a.startsWith("-"));
    const target = resolveArgPath(paths[0] ?? cwd, cwd);
    if (asBot && isReservedControlPlanePath(target)) return denied("Permission denied");
    const dir = this.fs.get(target);
    if (!dir || !dir.isDir) {
      return { exitCode: 2, stdout: "", stderr: "ls: cannot access\n", timedOut: false };
    }
    const prefix = target.endsWith("/") ? target : `${target}/`;
    const children = new Set<string>();
    for (const key of this.fs.keys()) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length).split("/")[0];
      if (name) children.add(name);
    }
    let names = filterBotVisibleListing(target, [...children].sort());
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
    if (asBot && isReservedControlPlanePath(start)) return denied("Permission denied");
    const nameIdx = argv.indexOf("-name");
    const namePat = nameIdx >= 0 ? argv[nameIdx + 1] : undefined;
    const hits: string[] = [];
    for (const key of this.fs.keys()) {
      if (asBot && isReservedControlPlanePath(key)) continue;
      if (start !== "/" && key !== start && !key.startsWith(`${start}/`)) continue;
      if (start === "/" && isReservedControlPlanePath(key)) continue;
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
    out.set(k, { isDir: v.isDir, content: Buffer.from(v.content) });
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
  if (!trimmed) return [];
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

