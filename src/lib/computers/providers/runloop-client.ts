/**
 * Control-plane adapter for Runloop Devboxes.
 * RunloopProvider talks only to this interface so unit tests inject an in-memory
 * fake and never construct RunloopSDK / never touch the network.
 *
 * RUNLOOP_API_KEY must never appear in create env, exec env, or guest files.
 */

export const RUNLOOP_WORKSPACE_ROOT = "/home/user/flok";
export const RUNLOOP_PROVIDER_NAME = "runloop" as const;
export const DEFAULT_RUNLOOP_BLUEPRINT =
  "runloop/universal-ubuntu-24.04-x86_64-dnd";
export const DEFAULT_RUNLOOP_ARCH = "x86_64" as const;
/** Live CI max lifetime. Do not combine with lifecycle.after_idle. */
export const LIVE_KEEP_ALIVE_SECONDS = 15 * 60;

export const CONTROL_PLANE_SECRET_ENV_KEYS = [
  "RUNLOOP_API_KEY",
  "DAYTONA_API_KEY",
  "DAYTONA_JWT_TOKEN",
] as const;

export type RunloopDevboxState =
  | "provisioning"
  | "running"
  | "paused"
  | "stopped"
  | "deleted"
  | "error";

export interface RunloopCreateParams {
  birdId: string;
  flockId: string;
  blueprint: string;
  architecture: "x86_64" | "arm64";
  keepAliveSeconds: number;
  labels: Record<string, string>;
  /** Guest environment. Must not contain control-plane secrets. */
  envVars: Record<string, string>;
}

export interface RunloopExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunloopFsOk<T = undefined> {
  ok: true;
  data?: T;
}

export interface RunloopFsErr {
  ok: false;
  errorCode: string;
}

export type RunloopFsResult<T = undefined> = RunloopFsOk<T> | RunloopFsErr;

export interface RunloopDevboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  readonly bootId: string;

  state(): Promise<RunloopDevboxState>;
  /** disk-preserving suspend; RAM is discarded */
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /** Idempotent shutdown. */
  shutdown(): Promise<void>;

  exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<RunloopExecResult>;

  fsStat(path: string): Promise<RunloopFsResult<{ path: string; isDir: boolean; size: number }>>;
  fsList(path: string): Promise<RunloopFsResult<string[]>>;
  fsRead(path: string): Promise<RunloopFsResult<Buffer>>;
  fsWrite(path: string, body: Buffer): Promise<RunloopFsResult>;
  fsMkdir(path: string): Promise<RunloopFsResult>;
  fsDelete(path: string): Promise<RunloopFsResult>;
  fsMove(from: string, to: string): Promise<RunloopFsResult>;
  fsCopy(from: string, to: string): Promise<RunloopFsResult>;

  snapshotDisk(name: string): Promise<string>;
}

export interface RunloopControlPlane {
  create(params: RunloopCreateParams): Promise<RunloopDevboxSession>;
  get(id: string): Promise<RunloopDevboxSession>;
  restore(snapshotRef: string, params: RunloopCreateParams): Promise<RunloopDevboxSession>;
}

export function assertNoControlPlaneSecrets(env: Record<string, string> | undefined): void {
  if (!env) return;
  for (const key of CONTROL_PLANE_SECRET_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      throw new Error(`refusing to place control-plane secret ${key} inside a Node VM`);
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (/api[_-]?key/i.test(k) || /runloop/i.test(k) && /key|token|secret/i.test(k)) {
      throw new Error(`refusing to place control-plane secret ${k} inside a Node VM`);
    }
    if (typeof v === "string" && v.length > 8 && process.env.RUNLOOP_API_KEY === v) {
      throw new Error("refusing to place RUNLOOP_API_KEY value inside a Node VM");
    }
  }
}
