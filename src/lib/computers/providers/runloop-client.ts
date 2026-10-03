/**
 * Control-plane adapter for Runloop Devboxes.
 * RunloopProvider talks only to this interface so unit tests inject an in-memory
 * fake and never construct RunloopSDK / never touch the network.
 *
 * RUNLOOP_API_KEY must never appear in create env, exec env, or guest files.
 */

import { z } from "zod";
import type { Action } from "../types.js";

export const RUNLOOP_WORKSPACE_ROOT = "/home/user/flok";
export const RUNLOOP_PROVIDER_NAME = "runloop" as const;
export const DEFAULT_RUNLOOP_BLUEPRINT =
  "runloop/universal-ubuntu-24.04-x86_64-dnd";
export const DEFAULT_RUNLOOP_ARCH = "x86_64" as const;
/** Default keep-alive. Cron must refresh this; do not treat 15 minutes as a plan cap. */
export const LIVE_KEEP_ALIVE_SECONDS = 15 * 60;
/** Highest keep-alive we will request unless FLOK_RUNLOOP_KEEP_ALIVE_SECONDS is set. */
export const MAX_KEEP_ALIVE_SECONDS = 60 * 60;

export const CONTROL_PLANE_SECRET_ENV_KEYS = [
  "RUNLOOP_API_KEY",
  "RUNLOOP_BEARER_TOKEN",
  "DAYTONA_API_KEY",
  "DAYTONA_JWT_TOKEN",
  "FLOK_MCP_AUTH_TOKEN",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "CRON_SECRET",
  "STAXIONS_BIND_SECRET",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PAT",
  "GH_PAT",
] as const;

export type RunloopDevboxState =
  | "provisioning"
  | "running"
  | "paused"
  | "stopped"
  | "deleted"
  | "error";

/** Runloop reports both `shutdown` and `DEVBOX_SHUTDOWN`. */
export function mapRunloopDevboxStatus(status: string): RunloopDevboxState {
  const normalized = status.trim().toLowerCase().replace(/^devbox_/, "");
  switch (normalized) {
    case "running":
      return "running";
    case "suspended":
    case "suspending":
      return "paused";
    case "shutdown":
    case "stopped":
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

export interface RunloopCreateParams {
  birdId: string;
  flockId: string;
  blueprint: string;
  architecture: "x86_64" | "arm64";
  keepAliveSeconds: number;
  /** Used as after_idle.idle_time_seconds when FLOK_RUNLOOP_ON_IDLE=suspend. */
  idleTimeSeconds?: number;
  labels: Record<string, string>;
  /** Guest environment. Must not contain control-plane secrets. */
  envVars: Record<string, string>;
  /** Configured restrictive policy. Required for paid create/restore. */
  networkPolicyId?: string;
}

export type RunloopLaunchParameters = {
  architecture: "x86_64" | "arm64";
  network_policy_id: string;
} & (
  | { keep_alive_time_seconds: number }
  | { lifecycle: { after_idle: { idle_time_seconds: number; on_idle: "suspend" } } }
);

const RunloopOnIdleSchema = z.enum(["suspend"]).optional();

/** Empty and unset keep today's keep-alive. Any other value is a bad config. */
export function parseRunloopOnIdle(env: NodeJS.ProcessEnv = process.env): "suspend" | undefined {
  const trimmed = env.FLOK_RUNLOOP_ON_IDLE?.trim() ?? "";
  const parsed = RunloopOnIdleSchema.safeParse(trimmed === "" ? undefined : trimmed);
  if (!parsed.success) {
    throw new Error('FLOK_RUNLOOP_ON_IDLE must be unset or "suspend"');
  }
  return parsed.data;
}

/** Suspend-on-idle omits keep_alive. Runloop ignores keep_alive when after_idle is set. */
export function runloopLaunchParameters(
  params: RunloopCreateParams,
  fallbackKeepAlive: number,
  onIdle: "suspend" | undefined,
  networkPolicyId: string,
): RunloopLaunchParameters {
  const policyId = networkPolicyId.trim();
  if (!policyId) {
    throw new Error("network_policy_id is required for paid Runloop create/restore");
  }
  const architecture = params.architecture || DEFAULT_RUNLOOP_ARCH;
  if (onIdle === "suspend") {
    return {
      architecture,
      network_policy_id: policyId,
      lifecycle: {
        after_idle: {
          idle_time_seconds: params.idleTimeSeconds ?? (params.keepAliveSeconds || fallbackKeepAlive),
          on_idle: "suspend",
        },
      },
    };
  }
  return {
    architecture,
    network_policy_id: policyId,
    keep_alive_time_seconds: params.keepAliveSeconds || fallbackKeepAlive,
  };
}

/**
 * Launch mode only. No policy ids, keys, env values, or hostnames.
 * `enforcement` records that vendor acceptance is not an instant revoke.
 */
export function logRunloopLaunch(op: "create" | "restore", launch: RunloopLaunchParameters): void {
  const line =
    "lifecycle" in launch
      ? {
          op,
          mode: "suspend" as const,
          idle_s: launch.lifecycle.after_idle.idle_time_seconds,
          policy_attached: true,
          enforcement: "eventually-consistent" as const,
        }
      : {
          op,
          mode: "keep_alive" as const,
          keep_alive_s: launch.keep_alive_time_seconds,
          policy_attached: true,
          enforcement: "eventually-consistent" as const,
        };
  process.stderr.write(`runloop.launch ${JSON.stringify(line)}\n`);
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
  /** True when guest has flok-ui / Xvfb / Chrome. Agent Computer requires this. */
  interactiveGuest: boolean;

  state(): Promise<RunloopDevboxState>;
  /**
   * Policy id echoed on launch parameters. Null means a legacy devbox with no
   * attached policy. Callers must not treat null as unrestricted success.
   */
  readLaunchPolicyId(): Promise<string | null>;
  /** disk-preserving suspend; RAM is discarded */
  suspend(): Promise<void>;
  /**
   * Installed SDK resume accepts polling options only, not a network policy.
   * Callers must verify the existing attachment before invoking this.
   */
  resume(): Promise<void>;
  /** Idempotent shutdown. */
  shutdown(): Promise<void>;
  /** Reset vendor idle/keep-alive. Optional on memory fakes. */
  keepAlive?(): Promise<void>;

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

  /** C3B: start or no-op restart of display/WM/VNC. Idempotent. */
  ensureInteractiveStack(opts?: { browser?: "strict" | "best-effort" }): Promise<void>;
  screenshot(): Promise<{ width: number; height: number; png: Buffer; activeWindow?: string }>;
  novncLocalOk(): Promise<boolean>;
  uiAction(action: Action): Promise<{ finalUrl?: string } | void>;
  /** Guest Chrome CDP dump. Memory plane has no Chrome and must fail closed. */
  cdpAxDump(): Promise<{
    nodes: unknown[];
    viewportOrigin?: { x: number; y: number };
    devicePixelRatio?: number;
  }>;
  /** Current page URL when CDP is up. Memory plane omits it. */
  browserUrl?(): Promise<string | undefined>;
}

export interface RunloopControlPlane {
  create(params: RunloopCreateParams): Promise<RunloopDevboxSession>;
  get(id: string): Promise<RunloopDevboxSession>;
  restore(snapshotRef: string, params: RunloopCreateParams): Promise<RunloopDevboxSession>;
  /** Read a vendor policy. Implementations must not create an unrestricted policy. */
  retrieveNetworkPolicy(id: string): Promise<unknown>;
}

export function assertNoControlPlaneSecrets(env: Record<string, string> | undefined): void {
  if (!env) return;
  for (const key of CONTROL_PLANE_SECRET_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      throw new Error(`refusing to place control-plane secret ${key} inside a Node VM`);
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (/api[_-]?key/i.test(k) || (/runloop/i.test(k) && /key|token|secret/i.test(k))) {
      throw new Error(`refusing to place control-plane secret ${k} inside a Node VM`);
    }
    if (typeof v === "string" && containsControlPlaneSecret(v)) {
      throw new Error("refusing to place a control-plane secret value inside a Node VM");
    }
  }
}

function secretValues(env: NodeJS.ProcessEnv): string[] {
  const values: string[] = [];
  for (const key of CONTROL_PLANE_SECRET_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 8) values.push(value);
  }
  return values;
}

/** Replace known control-plane secret values. Does not log the secret. */
export function redactControlPlaneSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = text;
  for (const secret of secretValues(env)) {
    if (redacted.includes(secret)) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

export function containsControlPlaneSecret(text: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return secretValues(env).some((secret) => text.includes(secret));
}

export const FORBIDDEN_DEVBOX_CREDENTIAL_KEYS = [
  "secrets",
  "gateways",
  "mcp",
  "file_mounts",
  "code_mounts",
  "mounts",
  "tunnel",
  "entrypoint",
] as const;

/** Reject vendor create fields that inject credentials or open an alternate network path. */
export function assertNoCredentialInjectionChannels(body: Record<string, unknown>): void {
  for (const key of FORBIDDEN_DEVBOX_CREDENTIAL_KEYS) {
    if (body[key] != null) {
      throw new Error(`refusing devbox ${key}: credential or alternate network channel`);
    }
  }
  const env = body.environment_variables;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    assertNoControlPlaneSecrets(env as Record<string, string>);
  }
}

/**
 * Shutdown is idempotent only for a missing/already-gone Devbox.
 * Do not treat a generic "shutdown request failed" as success.
 */
export function isIdempotentShutdownError(err: unknown): boolean {
  if (err !== null && typeof err === "object") {
    const rec = err as { status?: number; statusCode?: number };
    const code = rec.status ?? rec.statusCode;
    if (code === 404) return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /not found|no such|\bdeleted\b|already (?:shut\s?down|gone|deleted|not found)/i.test(msg);
}
