/**
 * In-memory Daytona control plane for unit/contract tests.
 * Zero network. Two sessions have independent filesystems, boot IDs,
 * browser-profile markers, and lifecycle.
 */

import { randomBytes } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { PathEscape } from "../errors.js";
import type {
  ActionBatch,
  ActionResult,
  Observation,
  ObserveRequest,
  TakeoverGrant,
} from "../types.js";
import {
  assertNoControlPlaneSecrets,
  DAYTONA_WORKSPACE_ROOT,
  type DaytonaControlPlane,
  type DaytonaCreateParams,
  type DaytonaExecResult,
  type DaytonaFsResult,
  type DaytonaSandboxSession,
} from "./daytona-client.js";

interface MemFile {
  isDir: boolean;
  content: Buffer;
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

export class MemoryDaytonaControlPlane implements DaytonaControlPlane {
  private readonly sessions = new Map<string, MemoryDaytonaSandbox>();
  /** Snapshots: name → cloned filesystem. */
  private readonly snapshots = new Map<string, Map<string, MemFile>>();

  async create(params: DaytonaCreateParams): Promise<DaytonaSandboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const id = newId("dton");
    const session = new MemoryDaytonaSandbox(id, params, this.snapshots);
    this.sessions.set(id, session);
    return session;
  }

  async get(id: string): Promise<DaytonaSandboxSession> {
    const s = this.sessions.get(id);
    if (!s || s.destroyed) {
      throw new Error(`daytona sandbox ${id} not found`);
    }
    return s;
  }

  async restore(snapshotRef: string, params: DaytonaCreateParams): Promise<DaytonaSandboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const snap = this.snapshots.get(snapshotRef);
    if (!snap) throw new Error(`snapshot ${snapshotRef} not found`);
    const session = (await this.create(params)) as MemoryDaytonaSandbox;
    session.replaceFs(cloneFs(snap));
    return session;
  }
}

class MemoryDaytonaSandbox implements DaytonaSandboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  readonly bootId: string;
  readonly browserProfileId: string;
  destroyed = false;
  private current: "started" | "stopped" | "paused" | "archived" | "destroyed" | "error" =
    "started";
  private fs: Map<string, MemFile>;
  private readonly snapshots: Map<string, Map<string, MemFile>>;

  constructor(
    id: string,
    params: DaytonaCreateParams,
    snapshots: Map<string, Map<string, MemFile>>,
  ) {
    this.id = id;
    this.birdId = params.birdId;
    this.flockId = params.flockId;
    this.bootId = randomBytes(16).toString("hex");
    this.browserProfileId = `profile-${randomBytes(8).toString("hex")}`;
    this.snapshots = snapshots;
    this.fs = new Map();
    this.fs.set(DAYTONA_WORKSPACE_ROOT, { isDir: true, content: Buffer.alloc(0) });
    this.fs.set(`${DAYTONA_WORKSPACE_ROOT}/.flok-browser-profile`, {
      isDir: true,
      content: Buffer.alloc(0),
    });
    this.fs.set(`${DAYTONA_WORKSPACE_ROOT}/.flok-browser-profile/id`, {
      isDir: false,
      content: Buffer.from(this.browserProfileId, "utf8"),
    });
  }

  replaceFs(fs: Map<string, MemFile>): void {
    this.fs = fs;
  }

  async state() {
    return this.current;
  }

  async start(): Promise<void> {
    this.assertAlive();
    if (this.current === "paused" || this.current === "stopped") {
      this.current = "started";
    }
  }

  async stop(): Promise<void> {
    this.assertAlive();
    this.current = "stopped";
  }

  async pause(): Promise<void> {
    this.assertAlive();
    if (this.current !== "started") {
      throw new Error("pause requires a running Linux VM");
    }
    this.current = "paused";
  }

  async delete(): Promise<void> {
    this.current = "destroyed";
    this.destroyed = true;
  }

  async exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<DaytonaExecResult> {
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
      stderr: `memory-daytona: unsupported argv ${JSON.stringify(argv)}`,
      timedOut: false,
    };
  }

  async fsStat(
    path: string,
  ): Promise<DaytonaFsResult<{ path: string; isDir: boolean; size: number }>> {
    this.assertRunning();
    const file = this.fs.get(path);
    if (!file) return { ok: false, errorCode: "NOT_FOUND" };
    return { ok: true, data: { path, isDir: file.isDir, size: file.content.length } };
  }

  async fsList(path: string): Promise<DaytonaFsResult<string[]>> {
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

  async fsRead(path: string): Promise<DaytonaFsResult<Buffer>> {
    this.assertRunning();
    const file = this.fs.get(path);
    if (!file || file.isDir) return { ok: false, errorCode: "NOT_FOUND" };
    return { ok: true, data: file.content };
  }

  async fsWrite(path: string, body: Buffer): Promise<DaytonaFsResult> {
    this.assertRunning();
    const parent = pathPosix.dirname(path);
    if (parent !== path && !this.fs.get(parent)?.isDir) {
      return { ok: false, errorCode: "NOT_FOUND" };
    }
    this.fs.set(path, { isDir: false, content: Buffer.from(body) });
    return { ok: true };
  }

  async fsMkdir(path: string): Promise<DaytonaFsResult> {
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

  async fsDelete(path: string): Promise<DaytonaFsResult> {
    this.assertRunning();
    if (path === DAYTONA_WORKSPACE_ROOT) return { ok: false, errorCode: "PATH_ESCAPE" };
    if (!this.fs.has(path)) return { ok: false, errorCode: "NOT_FOUND" };
    for (const key of [...this.fs.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.fs.delete(key);
    }
    return { ok: true };
  }

  async fsMove(from: string, to: string): Promise<DaytonaFsResult> {
    this.assertRunning();
    const src = this.fs.get(from);
    if (!src) return { ok: false, errorCode: "NOT_FOUND" };
    this.fs.set(to, { isDir: src.isDir, content: Buffer.from(src.content) });
    this.fs.delete(from);
    return { ok: true };
  }

  async fsCopy(from: string, to: string): Promise<DaytonaFsResult> {
    this.assertRunning();
    const src = this.fs.get(from);
    if (!src) return { ok: false, errorCode: "NOT_FOUND" };
    this.fs.set(to, { isDir: src.isDir, content: Buffer.from(src.content) });
    return { ok: true };
  }

  async observe(request: ObserveRequest): Promise<Observation> {
    this.assertRunning();
    const obs: Observation = {
      screenWidth: 1280,
      screenHeight: 720,
      activeWindow: `flok-${this.birdId}`,
    };
    if (request.includeScreenshot) {
      obs.screenshotBase64 = Buffer.from(`screen-${this.id}`).toString("base64");
    }
    if (request.includeAccessibility) {
      obs.accessibilitySummary = { profile: this.browserProfileId, birdId: this.birdId };
    }
    return obs;
  }

  async act(request: ActionBatch): Promise<ActionResult> {
    this.assertRunning();
    return {
      ok: true,
      results: request.actions.map((action) => ({ action, success: true })),
    };
  }

  async takeover(): Promise<TakeoverGrant> {
    this.assertRunning();
    const expiresAt = new Date(Date.now() + 60_000);
    return {
      url: `https://novnc.example.invalid/${this.id}?token=${randomBytes(8).toString("hex")}`,
      expiresAt,
      singleUse: true,
    };
  }

  async checkpoint(name: string): Promise<string> {
    this.assertAlive();
    this.snapshots.set(name, cloneFs(this.fs));
    return name;
  }

  private assertAlive(): void {
    if (this.destroyed || this.current === "destroyed") {
      throw new Error(`daytona sandbox ${this.id} destroyed`);
    }
  }

  private assertRunning(): void {
    this.assertAlive();
    if (this.current !== "started") {
      throw new Error(`daytona sandbox ${this.id} is ${this.current}`);
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
