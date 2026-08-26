/**
 * RunloopProvider — production v1 ComputerProvider (C3A compute substrate).
 * Official @runloop/api-client RunloopSDK behind RunloopControlPlane.
 *
 * Control-plane secrets (RUNLOOP_API_KEY) never enter the guest.
 * Shell mode is rejected. Filesystem is jailed to /home/user/flok.
 *
 * Suspend preserves disk, not RAM (pauseMemory: false).
 * C3B: screenshot + bounded input on a private display (as flok-ui).
 * takeover/vnc stay fail-closed. computerUse is true after paid C3B live.
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
import { mapCdpAxDump, validateAction } from "./runloop-interactive.js";
import {
  assertNoControlPlaneSecrets,
  DEFAULT_RUNLOOP_ARCH,
  DEFAULT_RUNLOOP_BLUEPRINT,
  LIVE_KEEP_ALIVE_SECONDS,
  RUNLOOP_PROVIDER_NAME,
  RUNLOOP_WORKSPACE_ROOT,
  type RunloopControlPlane,
  type RunloopCreateParams,
  type RunloopDevboxSession,
} from "./runloop-client.js";
import { MemoryRunloopControlPlane } from "./runloop-memory.js";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_OUTPUT = 1_000_000;

export class RunloopBlueprintRequired extends ComputerError {
  constructor(detail: string) {
    super("RUNLOOP_BLUEPRINT_REQUIRED", detail);
    this.name = "RunloopBlueprintRequired";
  }
}

export class ComputerUseNotAvailable extends ComputerError {
  constructor(
    detail = "Secure human takeover is not enabled; local noVNC stays on 127.0.0.1",
  ) {
    super("C3B_TAKEOVER_UNAVAILABLE", detail);
    this.name = "ComputerUseNotAvailable";
  }
}

export class RunloopProvider implements ComputerProvider {
  readonly name = RUNLOOP_PROVIDER_NAME;
  private readonly plane: RunloopControlPlane;
  private readonly blueprint: string;
  private readonly keepAliveSeconds: number;
  private readonly sessions = new Map<string, RunloopDevboxSession>();

  constructor(opts?: {
    client?: RunloopControlPlane;
    blueprint?: string;
    apiKey?: string;
    keepAliveSeconds?: number;
  }) {
    this.blueprint =
      opts?.blueprint ?? process.env.FLOK_RUNLOOP_BLUEPRINT ?? DEFAULT_RUNLOOP_BLUEPRINT;
    this.keepAliveSeconds = opts?.keepAliveSeconds ?? LIVE_KEEP_ALIVE_SECONDS;
    if (opts?.client) {
      this.plane = opts.client;
      return;
    }
    const apiKey = opts?.apiKey ?? process.env.RUNLOOP_API_KEY ?? "";
    if (!apiKey) {
      throw new ProviderUnavailable("runloop", "RUNLOOP_API_KEY is required");
    }
    if (!this.blueprint) {
      throw new RunloopBlueprintRequired("FLOK_RUNLOOP_BLUEPRINT is required");
    }
    throw new ProviderUnavailable(
      "runloop",
      "use RunloopProvider.fromEnv() to load @runloop/api-client, or inject { client }",
    );
  }

  static async fromEnv(): Promise<RunloopProvider> {
    const apiKey = process.env.RUNLOOP_API_KEY ?? "";
    const blueprint =
      process.env.FLOK_RUNLOOP_BLUEPRINT ?? DEFAULT_RUNLOOP_BLUEPRINT;
    if (!apiKey) {
      throw new ProviderUnavailable("runloop", "RUNLOOP_API_KEY is required");
    }
    if (!blueprint) {
      throw new RunloopBlueprintRequired("FLOK_RUNLOOP_BLUEPRINT is required");
    }
    const { createSdkRunloopPlane } = await import("./runloop-sdk.js");
    const client = await createSdkRunloopPlane({
      apiKey,
      blueprint,
      keepAliveSeconds: LIVE_KEEP_ALIVE_SECONDS,
    });
    return new RunloopProvider({ client, blueprint, apiKey });
  }

  capabilities(): ProviderCapabilities {
    return {
      linuxVm: true,
      windowsVm: false,
      computerUse: true,
      accessibility: false,
      vnc: false,
      pauseMemory: false,
      snapshots: true,
      forks: true,
      customImages: true,
      networkPolicy: true,
    };
  }

  async provision(spec: ComputerSpec): Promise<ProviderComputer> {
    if (spec.osType === "windows") {
      throw new ProviderUnavailable("runloop", "linux only");
    }
    const params = this.createParams(spec);
    const session = await this.plane.create(params);
    this.sessions.set(session.id, session);
    try {
      await session.fsMkdir(RUNLOOP_WORKSPACE_ROOT).catch(() => undefined);
      await session.ensureInteractiveStack();
    } catch (e) {
      await this.abandonSession(session.id);
      throw e;
    }
    return { providerRef: session.id, status: "ready" };
  }

  async status(ref: string): Promise<ComputerStatus> {
    const s = await this.requireSession(ref);
    const st = await s.state();
    let state: ComputerStatus["state"];
    if (st === "running") state = "running";
    else if (st === "paused") state = "paused";
    else if (st === "stopped") state = "stopped";
    else if (st === "deleted") state = "deleted";
    else if (st === "provisioning") state = "provisioning";
    else state = "error";
    return { state, providerDetail: `runloop:${s.birdId}` };
  }

  async wake(ref: string): Promise<void> {
    const s = await this.requireSession(ref);
    await s.resume();
    await s.ensureInteractiveStack();
  }

  async pause(ref: string): Promise<void> {
    const s = await this.requireSession(ref);
    await s.suspend();
  }

  async stop(ref: string): Promise<void> {
    const s = await this.requireSession(ref);
    await s.shutdown();
  }

  async destroy(ref: string): Promise<void> {
    const s = await this.requireSession(ref).catch(() => null);
    if (s) {
      await s.shutdown().catch(() => undefined);
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
        ? assertInsideRoot(request.cwd, RUNLOOP_WORKSPACE_ROOT)
        : RUNLOOP_WORKSPACE_ROOT;
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
        stdout: result.stdout.slice(0, MAX_OUTPUT),
        stderr: result.stderr.slice(0, MAX_OUTPUT),
        timedOut: result.timedOut,
      };
    } catch (e) {
      throw new ProviderUnavailable(
        "runloop",
        e instanceof Error ? e.message : "exec failed",
      );
    }
  }

  async filesystem(ref: string, request: FsRequest): Promise<FsResult> {
    const s = await this.requireSession(ref);
    let canonical: string;
    try {
      canonical = assertInsideRoot(request.path, RUNLOOP_WORKSPACE_ROOT);
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
        if (canonical === RUNLOOP_WORKSPACE_ROOT) {
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
          dest = assertInsideRoot(request.destination, RUNLOOP_WORKSPACE_ROOT);
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
    await s.ensureInteractiveStack();
    const shot = await s.screenshot();
    const obs: Observation = {
      screenWidth: shot.width,
      screenHeight: shot.height,
    };
    if (shot.activeWindow) obs.activeWindow = shot.activeWindow;
    if (request.includeScreenshot !== false) {
      obs.screenshotBase64 = shot.png.toString("base64");
    }
    if (request.includeAccessibility) {
      try {
        const dump = await s.cdpAxDump();
        obs.accessibilitySummary = mapCdpAxDump(dump);
      } catch (err) {
        if (err instanceof ComputerError && !(err instanceof ProviderUnavailable)) {
          throw err;
        }
        throw new ComputerUseNotAvailable(
          "accessibility addressing requires guest Chrome CDP",
        );
      }
    }
    return obs;
  }

  async act(ref: string, request: ActionBatch): Promise<ActionResult> {
    const s = await this.requireSession(ref);
    await s.ensureInteractiveStack();
    const results: ActionResult["results"] = [];
    let ok = true;
    for (let i = 0; i < request.actions.length; i++) {
      const action = request.actions[i]!;
      const err = validateAction(action);
      if (err) {
        ok = false;
        results.push({ action, success: false, error: err });
        for (const rest of request.actions.slice(i + 1)) {
          results.push({ action: rest, success: false, error: "not executed" });
        }
        break;
      }
      try {
        await s.uiAction(action);
        results.push({ action, success: true });
      } catch (e) {
        ok = false;
        results.push({
          action,
          success: false,
          error: e instanceof Error ? e.message : "action failed",
        });
        for (const rest of request.actions.slice(i + 1)) {
          results.push({ action: rest, success: false, error: "not executed" });
        }
        break;
      }
    }
    return { ok, results };
  }

  async takeover(_ref: string): Promise<TakeoverGrant> {
    throw new ComputerUseNotAvailable();
  }

  async checkpoint(ref: string): Promise<ProviderCheckpoint> {
    const s = await this.requireSession(ref);
    const name = `flok-${ref}-${Date.now()}`;
    const snap = await s.snapshotDisk(name);
    return { providerSnapshotRef: snap };
  }

  async restore(request: RestoreRequest): Promise<ProviderComputer> {
    if (!request.providerSnapshotRef) {
      throw new ProviderUnavailable("runloop", "providerSnapshotRef required");
    }
    const existing = request.computerId
      ? this.sessions.get(request.computerId)
      : undefined;
    const params: RunloopCreateParams = {
      birdId: existing?.birdId ?? "restore",
      flockId: existing?.flockId ?? "restore",
      blueprint: this.blueprint,
      architecture: DEFAULT_RUNLOOP_ARCH,
      keepAliveSeconds: this.keepAliveSeconds,
      labels: {
        "flok.provider": "runloop",
        "flok.isolation": "linux-vm",
      },
      envVars: {},
    };
    const session = await this.plane.restore(request.providerSnapshotRef, params);
    this.sessions.set(session.id, session);
    try {
      await session.ensureInteractiveStack();
    } catch (e) {
      await this.abandonSession(session.id);
      throw e;
    }
    return { providerRef: session.id, status: "ready" };
  }

  private createParams(spec: ComputerSpec): RunloopCreateParams {
    const envVars: Record<string, string> = {};
    assertNoControlPlaneSecrets(envVars);
    return {
      birdId: spec.birdId,
      flockId: spec.flockId,
      blueprint: this.blueprint || DEFAULT_RUNLOOP_BLUEPRINT,
      architecture: DEFAULT_RUNLOOP_ARCH,
      keepAliveSeconds: this.keepAliveSeconds,
      labels: {
        "flok.provider": "runloop",
        "flok.bird_id": spec.birdId,
        "flok.flock_id": spec.flockId,
        "flok.isolation": "linux-vm",
      },
      envVars,
    };
  }

  private async requireSession(ref: string): Promise<RunloopDevboxSession> {
    const cached = this.sessions.get(ref);
    if (cached) return cached;
    try {
      const s = await this.plane.get(ref);
      this.sessions.set(ref, s);
      return s;
    } catch (e) {
      throw new ProviderUnavailable(
        "runloop",
        e instanceof Error ? e.message : `devbox ${ref} not found`,
      );
    }
  }

  /** Unregister and shut down a session the caller never received a providerRef for. */
  private async abandonSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (session) {
      await session.shutdown().catch(() => undefined);
    }
  }
}

export function runloopJoin(rel: string): string {
  return pathPosix.normalize(pathPosix.join(RUNLOOP_WORKSPACE_ROOT, rel));
}

export {
  MemoryRunloopControlPlane,
  RUNLOOP_WORKSPACE_ROOT,
  RUNLOOP_PROVIDER_NAME,
  DEFAULT_RUNLOOP_BLUEPRINT,
};
