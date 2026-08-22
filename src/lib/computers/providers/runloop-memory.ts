/**
 * In-memory Runloop control plane for unit/contract tests.
 * Zero network. Two sessions have independent filesystems, boot IDs,
 * and lifecycle. Suspend preserves disk, not RAM.
 */

import { randomBytes } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { PathEscape } from "../errors.js";
import type { Action } from "../types.js";
import {
  BROWSER_PROFILE_DIR,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  INTERACTIVE_DIR,
} from "./runloop-interactive.js";
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

  async create(params: RunloopCreateParams): Promise<RunloopDevboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const id = newId("rlbox");
    const session = new MemoryRunloopDevbox(id, params, this.snapshots);
    this.sessions.set(id, session);
    return session;
  }

  async get(id: string): Promise<RunloopDevboxSession> {
    const s = this.sessions.get(id);
    if (!s || s.destroyed) {
      throw new Error(`runloop devbox ${id} not found`);
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
  destroyed = false;
  /** How many times ensureInteractiveStack actually (re)started. */
  stackStarts = 0;
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
    this.current = "paused";
    this.stackUp = false;
  }

  async resume(): Promise<void> {
    this.assertAlive();
    if (this.current === "paused" || this.current === "stopped") {
      this.current = "running";
    }
  }

  async shutdown(): Promise<void> {
    this.current = "deleted";
    this.destroyed = true;
  }

  async exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<RunloopExecResult> {
    this.assertRunning();
    assertNoControlPlaneSecrets(req.env);
    const argv = req.argv;
    const cmd = argv[0] ?? "";

    if (cmd === "true") {
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    }
    if (cmd === "cat" && argv[1] === "/proc/sys/kernel/random/boot_id") {
      return { exitCode: 0, stdout: `${this.bootId}\n`, stderr: "", timedOut: false };
    }
    if (cmd === "cat") {
      const target = resolveArgPath(argv[1], req.cwd);
      const file = this.fs.get(target);
      if (!file || file.isDir) {
        return { exitCode: 1, stdout: "", stderr: "cat: not found\n", timedOut: false };
      }
      return { exitCode: 0, stdout: file.content.toString("utf8"), stderr: "", timedOut: false };
    }
    if (cmd === "pwd") {
      return { exitCode: 0, stdout: `${req.cwd}\n`, stderr: "", timedOut: false };
    }
    if (cmd === "printenv") {
      const key = argv[1];
      const val = key && req.env ? (req.env[key] ?? "") : "";
      return { exitCode: 0, stdout: val, stderr: "", timedOut: false };
    }
    if (cmd === "sleep") {
      const sec = Number(argv[1] ?? "0");
      if (sec * 1000 > req.timeoutMs) {
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

  async ensureInteractiveStack(): Promise<void> {
    this.assertAlive();
    if (this.current !== "running") {
      throw new Error(`runloop devbox ${this.id} is ${this.current}`);
    }
    if (!this.stackUp) {
      this.stackStarts += 1;
      this.stackUp = true;
    }
    await this.fsMkdir(BROWSER_PROFILE_DIR);
    await this.fsMkdir(INTERACTIVE_DIR);
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

  async uiAction(action: Action): Promise<void> {
    this.assertRunning();
    if (!this.stackUp) await this.ensureInteractiveStack();
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

/** 1×1 PNG. Memory-plane screenshot stub — not a real display capture. */
const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

