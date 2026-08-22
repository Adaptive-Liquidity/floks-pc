/**
 * DaytonaProvider — production v1 ComputerProvider.
 * Linux VM class only. Official @daytona/sdk behind DaytonaControlPlane.
 *
 * Control-plane secrets (DAYTONA_API_KEY) never enter the guest.
 * Shell mode is rejected. Filesystem is jailed to /home/flok.
 */

import { posix as pathPosix } from "node:path";
import type { ComputerProvider } from "./provider.js";
import type {
  ActionBatch,
  ActionResult,
  ComputerSpec,
  ComputerStatus,
  ExecRequest,
  ExecResult,
  FsRequest,
  FsResult,
  Observation,
  ObserveRequest,
  ProviderCapabilities,
  ProviderCheckpoint,
  ProviderComputer,
  RestoreRequest,
  TakeoverGrant,
} from "../types.js";
import { ComputerError, PathEscape, ProviderUnavailable } from "../errors.js";
import { assertInsideRoot } from "../path.js";
import {
  assertNoControlPlaneSecrets,
  DAYTONA_WORKSPACE_ROOT,
  type DaytonaControlPlane,
  type DaytonaCreateParams,
  type DaytonaSandboxSession,
} from "./daytona-client.js";
import { MemoryDaytonaControlPlane } from "./daytona-memory.js";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DAYTONA_PROVIDER_NAME = "daytona" as const;

export class DaytonaLinuxVmRequired extends ComputerError {
  constructor(detail: string) {
    super("DAYTONA_LINUX_VM_REQUIRED", detail);
    this.name = "DaytonaLinuxVmRequired";
  }
}

export class DaytonaProvider implements ComputerProvider {
  readonly name = DAYTONA_PROVIDER_NAME;
  private readonly plane: DaytonaControlPlane;
  private readonly snapshot: string;
  private readonly sessions = new Map<string, DaytonaSandboxSession>();

  constructor(opts?: {
    client?: DaytonaControlPlane;
    snapshot?: string;
    apiKey?: string;
  }) {
    this.snapshot =
      opts?.snapshot ?? process.env.FLOK_DAYTONA_SNAPSHOT ?? "";
    if (opts?.client) {
      this.plane = opts.client;
      return;
    }
    const apiKey = opts?.apiKey ?? process.env.DAYTONA_API_KEY ?? "";
    if (!apiKey) {
      throw new ProviderUnavailable("daytona", "DAYTONA_API_KEY is required");
    }
    if (!this.snapshot) {
      throw new DaytonaLinuxVmRequired(
        "FLOK_DAYTONA_SNAPSHOT must name a Linux VM snapshot (not the default container class)",
      );
    }
    throw new ProviderUnavailable(
      "daytona",
      "use DaytonaProvider.fromEnv() to load @daytona/sdk, or inject { client }",
    );
  }

  /** Production/live constructor. Loads official @daytona/sdk. */
  static async fromEnv(): Promise<DaytonaProvider> {
    const apiKey = process.env.DAYTONA_API_KEY ?? "";
    const snapshot = process.env.FLOK_DAYTONA_SNAPSHOT ?? "";
    if (!apiKey) {
      throw new ProviderUnavailable("daytona", "DAYTONA_API_KEY is required");
    }
    if (!snapshot) {
      throw new DaytonaLinuxVmRequired(
        "FLOK_DAYTONA_SNAPSHOT must name a Linux VM snapshot (not the default container class)",
      );
    }
    const { createSdkDaytonaPlane } = await import("./daytona-sdk.js");
    const client = await createSdkDaytonaPlane({ apiKey, snapshot });
    return new DaytonaProvider({ client, snapshot, apiKey });
  }

  capabilities(): ProviderCapabilities {
    return {
      linuxVm: true,
      windowsVm: false,
      computerUse: true,
      accessibility: true,
      vnc: true,
      pauseMemory: true,
      snapshots: true,
      forks: true,
      customImages: true,
      networkPolicy: true,
    };
  }

  async provision(spec: ComputerSpec): Promise<ProviderComputer> {
    if (spec.osType === "windows") {
      throw new ProviderUnavailable("daytona", "linux VM only");
    }
    const params = this.createParams(spec);
    const session = await this.plane.create(params);
    this.sessions.set(session.id, session);
    await session.fsMkdir(DAYTONA_WORKSPACE_ROOT).catch(() => undefined);
    return { providerRef: session.id, status: "ready" };
  }

  async status(ref: string): Promise<ComputerStatus> {
    const s = await this.requireSession(ref);
    const st = await s.state();
    let state: ComputerStatus["state"];
    if (st === "started") state = "running";
    else if (st === "paused") state = "paused";
    else if (st === "stopped" || st === "archived") state = "stopped";
    else if (st === "destroyed") state = "deleted";
    else state = "error";
    return { state, providerDetail: `daytona:${s.birdId}` };
  }

  async wake(ref: string): Promise<void> {
    const s = await this.requireSession(ref);
    await s.start();
  }

  async pause(ref: string): Promise<void> {
    const s = await this.requireSession(ref);
    await s.pause();
  }

  async stop(ref: string): Promise<void> {
    const s = await this.requireSession(ref);
    await s.stop();
  }

  async destroy(ref: string): Promise<void> {
    const s = await this.requireSession(ref).catch(() => null);
    if (s) {
      await s.delete().catch(() => undefined);
    }
    this.sessions.delete(ref);
  }

  async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    const s = await this.requireSession(ref);
    if (request.mode === "shell") {
      return {
        exitCode: 126,
        stdout: "",
        stderr: "shell mode not allowed; use argv[]",
        timedOut: false,
      };
    }
    if (!request.argv.length) {
      return { exitCode: 2, stdout: "", stderr: "empty argv", timedOut: false };
    }
    if (request.env) {
      for (const k of Object.keys(request.env)) {
        if (!ENV_KEY.test(k)) {
          return {
            exitCode: 2,
            stdout: "",
            stderr: `invalid environment variable name: ${k}`,
            timedOut: false,
          };
        }
      }
      try {
        assertNoControlPlaneSecrets(request.env);
      } catch (e) {
        return {
          exitCode: 126,
          stdout: "",
          stderr: e instanceof Error ? e.message : "secret env rejected",
          timedOut: false,
        };
      }
    }

    let cwd: string;
    try {
      cwd = request.cwd
        ? assertInsideRoot(request.cwd, DAYTONA_WORKSPACE_ROOT)
        : DAYTONA_WORKSPACE_ROOT;
    } catch (e) {
      if (e instanceof PathEscape) {
        return {
          exitCode: 126,
          stdout: "",
          stderr: `PATH_ESCAPE: cwd escapes workspace: ${request.cwd}`,
          timedOut: false,
        };
      }
      throw e;
    }

    const timeoutMs = Math.min(request.timeoutMs ?? 30_000, 600_000);
    const execReq: {
      argv: string[];
      cwd: string;
      env?: Record<string, string>;
      timeoutMs: number;
    } = {
      argv: request.argv,
      cwd,
      timeoutMs,
    };
    if (request.env) execReq.env = request.env;
    try {
      const result = await s.exec(execReq);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      };
    } catch (e) {
      throw new ProviderUnavailable(
        "daytona",
        e instanceof Error ? e.message : "exec failed",
      );
    }
  }

  async filesystem(ref: string, request: FsRequest): Promise<FsResult> {
    const s = await this.requireSession(ref);
    let canonical: string;
    try {
      canonical = assertInsideRoot(request.path, DAYTONA_WORKSPACE_ROOT);
    } catch (e) {
      if (e instanceof PathEscape) return { ok: false, errorCode: "PATH_ESCAPE" };
      throw e;
    }

    switch (request.operation) {
      case "stat": {
        const r = await s.fsStat(canonical);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        return { ok: true, data: r.data };
      }
      case "list": {
        const r = await s.fsList(canonical);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        return { ok: true, data: r.data };
      }
      case "read": {
        const r = await s.fsRead(canonical);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        const buf = r.data ?? Buffer.alloc(0);
        const data =
          request.encoding === "base64" ? buf.toString("base64") : buf.toString("utf8");
        return { ok: true, data };
      }
      case "write": {
        if (request.content === undefined) {
          return { ok: false, errorCode: "MISSING_CONTENT" };
        }
        const body =
          typeof request.content === "string"
            ? Buffer.from(request.content)
            : Buffer.from(request.content);
        const r = await s.fsWrite(canonical, body);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        return { ok: true };
      }
      case "mkdir": {
        const r = await s.fsMkdir(canonical);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        return { ok: true };
      }
      case "delete": {
        if (canonical === DAYTONA_WORKSPACE_ROOT) {
          return { ok: false, errorCode: "PATH_ESCAPE" };
        }
        const r = await s.fsDelete(canonical);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        return { ok: true };
      }
      case "move":
      case "copy": {
        if (!request.destination) {
          return { ok: false, errorCode: "MISSING_DESTINATION" };
        }
        let dest: string;
        try {
          dest = assertInsideRoot(request.destination, DAYTONA_WORKSPACE_ROOT);
        } catch {
          return { ok: false, errorCode: "PATH_ESCAPE" };
        }
        const r =
          request.operation === "move"
            ? await s.fsMove(canonical, dest)
            : await s.fsCopy(canonical, dest);
        if (!r.ok) return { ok: false, errorCode: r.errorCode };
        return { ok: true };
      }
      default:
        return { ok: false, errorCode: "UNSUPPORTED" };
    }
  }

  async observe(ref: string, request: ObserveRequest): Promise<Observation> {
    const s = await this.requireSession(ref);
    return s.observe(request);
  }

  async act(ref: string, request: ActionBatch): Promise<ActionResult> {
    const s = await this.requireSession(ref);
    return s.act(request);
  }

  async takeover(ref: string): Promise<TakeoverGrant> {
    const s = await this.requireSession(ref);
    return s.takeover();
  }

  async checkpoint(ref: string): Promise<ProviderCheckpoint> {
    const s = await this.requireSession(ref);
    const name = `flok-${ref}-${Date.now()}`;
    const snap = await s.checkpoint(name);
    return { providerSnapshotRef: snap };
  }

  async restore(request: RestoreRequest): Promise<ProviderComputer> {
    if (!request.providerSnapshotRef) {
      throw new ProviderUnavailable("daytona", "providerSnapshotRef required");
    }
    const existing = request.computerId
      ? this.sessions.get(request.computerId)
      : undefined;
    const params: DaytonaCreateParams = {
      birdId: existing?.birdId ?? "restore",
      flockId: existing?.flockId ?? "restore",
      snapshot: this.snapshot || request.providerSnapshotRef,
      labels: {
        "flok.provider": "daytona",
        "flok.isolation": "linux-vm",
      },
      envVars: {},
    };
    const session = await this.plane.restore(request.providerSnapshotRef, params);
    this.sessions.set(session.id, session);
    return { providerRef: session.id, status: "ready" };
  }

  private createParams(spec: ComputerSpec): DaytonaCreateParams {
    if (!this.snapshot && !(this.plane instanceof MemoryDaytonaControlPlane)) {
      throw new DaytonaLinuxVmRequired(
        "FLOK_DAYTONA_SNAPSHOT must name a Linux VM snapshot",
      );
    }
    const envVars: Record<string, string> = {};
    assertNoControlPlaneSecrets(envVars);
    const params: DaytonaCreateParams = {
      birdId: spec.birdId,
      flockId: spec.flockId,
      snapshot: this.snapshot || "memory-linux-vm",
      labels: {
        "flok.provider": "daytona",
        "flok.bird_id": spec.birdId,
        "flok.flock_id": spec.flockId,
        "flok.isolation": "linux-vm",
      },
      envVars,
    };
    if (spec.cpu !== undefined) params.cpu = spec.cpu;
    if (spec.memoryMb !== undefined) params.memoryGb = Math.max(1, Math.ceil(spec.memoryMb / 1024));
    if (spec.diskGb !== undefined) params.diskGb = spec.diskGb;
    return params;
  }

  private async requireSession(ref: string): Promise<DaytonaSandboxSession> {
    const cached = this.sessions.get(ref);
    if (cached) return cached;
    try {
      const s = await this.plane.get(ref);
      this.sessions.set(ref, s);
      return s;
    } catch (e) {
      throw new ProviderUnavailable(
        "daytona",
        e instanceof Error ? e.message : `sandbox ${ref} not found`,
      );
    }
  }
}

/** Join a path under the Daytona workspace (exported for tests). */
export function daytonaJoin(rel: string): string {
  return pathPosix.normalize(pathPosix.join(DAYTONA_WORKSPACE_ROOT, rel));
}

export { MemoryDaytonaControlPlane, DAYTONA_WORKSPACE_ROOT };
