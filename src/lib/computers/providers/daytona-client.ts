/**
 * Control-plane adapter for Daytona.
 * DaytonaProvider talks only to this interface so unit tests inject an in-memory
 * fake and never construct the official SDK / never touch the network.
 *
 * DAYTONA_API_KEY must never appear in create envVars, exec env, or guest files.
 */

import type {
  ActionBatch,
  ActionResult,
  Observation,
  ObserveRequest,
  TakeoverGrant,
} from "../types.js";

export const DAYTONA_WORKSPACE_ROOT = "/home/flok";

/** Env keys that must never be copied into a Node VM. */
export const CONTROL_PLANE_SECRET_ENV_KEYS = [
  "DAYTONA_API_KEY",
  "DAYTONA_JWT_TOKEN",
  "DAYTONA_ORGANIZATION_ID",
] as const;

export interface DaytonaCreateParams {
  birdId: string;
  flockId: string;
  /** Linux VM snapshot name/id. Required for the real SDK. */
  snapshot: string;
  labels: Record<string, string>;
  /** Guest environment. Must not contain control-plane secrets. */
  envVars: Record<string, string>;
  cpu?: number;
  memoryGb?: number;
  diskGb?: number;
}

export interface DaytonaExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface DaytonaFsOk<T = undefined> {
  ok: true;
  data?: T;
}

export interface DaytonaFsErr {
  ok: false;
  errorCode: string;
}

export type DaytonaFsResult<T = undefined> = DaytonaFsOk<T> | DaytonaFsErr;

export interface DaytonaSandboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  /** Unique per-VM identity used to prove distinct process namespaces. */
  readonly bootId: string;
  /** Unique per-VM browser-profile marker. */
  readonly browserProfileId: string;

  state(): Promise<"started" | "stopped" | "paused" | "archived" | "destroyed" | "error">;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  delete(): Promise<void>;

  exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<DaytonaExecResult>;

  fsStat(path: string): Promise<DaytonaFsResult<{ path: string; isDir: boolean; size: number }>>;
  fsList(path: string): Promise<DaytonaFsResult<string[]>>;
  fsRead(path: string): Promise<DaytonaFsResult<Buffer>>;
  fsWrite(path: string, body: Buffer): Promise<DaytonaFsResult>;
  fsMkdir(path: string): Promise<DaytonaFsResult>;
  fsDelete(path: string): Promise<DaytonaFsResult>;
  fsMove(from: string, to: string): Promise<DaytonaFsResult>;
  fsCopy(from: string, to: string): Promise<DaytonaFsResult>;

  observe(request: ObserveRequest): Promise<Observation>;
  act(request: ActionBatch): Promise<ActionResult>;
  takeover(): Promise<TakeoverGrant>;
  checkpoint(name: string): Promise<string>;
}

export interface DaytonaControlPlane {
  create(params: DaytonaCreateParams): Promise<DaytonaSandboxSession>;
  get(id: string): Promise<DaytonaSandboxSession>;
  restore(snapshotRef: string, params: DaytonaCreateParams): Promise<DaytonaSandboxSession>;
}

export function assertNoControlPlaneSecrets(env: Record<string, string> | undefined): void {
  if (!env) return;
  for (const key of CONTROL_PLANE_SECRET_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      throw new Error(`refusing to place control-plane secret ${key} inside a Node VM`);
    }
  }
}
