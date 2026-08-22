/**
 * Official @daytona/sdk adapter.
 * Loaded only by DaytonaProvider.fromEnv() / live tests — never by unit tests.
 *
 * Equivalent of:
 *   config = DaytonaConfig(api_key=...)
 *   daytona = Daytona(config)
 *   sandbox = daytona.create()
 */

import { Daytona } from "@daytona/sdk";
import { PathEscape, ProviderUnavailable } from "../errors.js";
import { assertInsideRoot } from "../path.js";
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

interface SdkSandbox {
  id: string;
  state?: string;
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<{ exitCode: number; result: string }>;
  };
  fs: {
    createFolder: (path: string, mode: string) => Promise<void>;
    deleteFile: (path: string, recursive?: boolean) => Promise<void>;
    downloadFile: (remotePath: string, timeout?: number) => Promise<Buffer>;
    getFileDetails: (path: string) => Promise<{ name: string; isDir: boolean; size: number }>;
    listFiles: (path: string) => Promise<Array<{ name: string }>>;
    moveFiles: (source: string, destination: string) => Promise<void>;
    uploadFile: (file: Buffer, remotePath: string, timeout?: number) => Promise<void>;
  };
  computerUse: {
    start: () => Promise<unknown>;
    screenshot: {
      takeFullScreen: (showCursor?: boolean) => Promise<{
        width?: number;
        height?: number;
        screenshot?: string;
        cursor_screenshot?: string;
      }>;
    };
    mouse: {
      click: (x: number, y: number, button?: string) => Promise<unknown>;
      move: (x: number, y: number) => Promise<unknown>;
      scroll: (x: number, y: number, direction: string, amount: number) => Promise<unknown>;
    };
    keyboard: {
      type: (text: string) => Promise<unknown>;
      press: (key: string, modifiers?: string[]) => Promise<unknown>;
    };
    accessibility?: {
      getTree?: (opts?: unknown) => Promise<unknown>;
    };
  };
  start: (timeout?: number) => Promise<void>;
  stop: (timeout?: number) => Promise<void>;
  pause: (timeout?: number) => Promise<void>;
  delete: (timeout?: number, wait?: boolean) => Promise<void>;
  createSnapshot: (name: string, timeout?: number) => Promise<void>;
  getSignedPreviewUrl: (
    port: number,
    expiresInSeconds?: number,
  ) => Promise<{ url: string; token?: string }>;
  getUserHomeDir: () => Promise<string | undefined>;
  refreshData: () => Promise<void>;
}

export async function createSdkDaytonaPlane(opts: {
  apiKey: string;
  snapshot: string;
  apiUrl?: string;
  target?: string;
}): Promise<DaytonaControlPlane> {
  const apiUrl = opts.apiUrl ?? process.env.DAYTONA_API_URL;
  const target = opts.target ?? process.env.DAYTONA_TARGET;
  return new SdkDaytonaControlPlane({
    apiKey: opts.apiKey,
    snapshot: opts.snapshot,
    apiUrl,
    preferredTarget: target,
  });
}

function clientConfig(apiKey: string, apiUrl: string | undefined, target: string | undefined): {
  apiKey: string;
  apiUrl?: string;
  target?: string;
} {
  const config: { apiKey: string; apiUrl?: string; target?: string } = { apiKey };
  if (apiUrl) config.apiUrl = apiUrl;
  if (target) config.target = target;
  return config;
}

class SdkDaytonaControlPlane implements DaytonaControlPlane {
  private readonly apiKey: string;
  private readonly apiUrl: string | undefined;
  private readonly defaultSnapshot: string;
  private readonly preferredTarget: string | undefined;
  private daytona: Daytona;

  constructor(opts: {
    apiKey: string;
    snapshot: string;
    apiUrl: string | undefined;
    preferredTarget: string | undefined;
  }) {
    this.apiKey = opts.apiKey;
    this.apiUrl = opts.apiUrl;
    this.defaultSnapshot = opts.snapshot;
    this.preferredTarget = opts.preferredTarget;
    this.daytona = new Daytona(clientConfig(opts.apiKey, opts.apiUrl, opts.preferredTarget));
  }

  private snapshotsToTry(requested: string): string[] {
    // Dashboard Linux VM snapshots (region "-"): not the us-region container images.
    const linuxVm = [
      requested,
      "daytona-vm-medium",
      "daytona-vm",
      "daytona-vm-large",
      "daytona-vm-ubuntu-xxl",
    ];
    const out: string[] = [];
    for (const name of linuxVm) {
      if (!out.includes(name)) out.push(name);
    }
    return out;
  }

  async create(params: DaytonaCreateParams): Promise<DaytonaSandboxSession> {
    assertNoControlPlaneSecrets(params.envVars);
    const requested = params.snapshot || this.defaultSnapshot;
    if (!requested) {
      throw new ProviderUnavailable("daytona", "Linux VM snapshot required");
    }

    const probe = new Daytona(clientConfig(this.apiKey, this.apiUrl, this.preferredTarget));
    const errors: string[] = [];

    for (const snapshotName of this.snapshotsToTry(requested)) {
      let sandboxClass = "unknown";
      let regionIds: string[] = [];
      try {
        const info = await probe.snapshot.get(snapshotName);
        sandboxClass = String(info.sandboxClass ?? "unknown");
        regionIds = Array.isArray(info.regionIds) ? info.regionIds.filter(Boolean) : [];
        if (info.sandboxClass && info.sandboxClass !== "linux-vm") {
          errors.push(`${snapshotName}: skip sandboxClass=${info.sandboxClass}`);
          continue;
        }
      } catch (e) {
        errors.push(
          `${snapshotName}: snapshot.get failed (${e instanceof Error ? e.message : String(e)})`,
        );
        continue;
      }

      const targets: Array<string | undefined> = [];
      const addTarget = (t: string | undefined) => {
        if (t && !targets.includes(t)) targets.push(t);
      };
      addTarget(this.preferredTarget);
      for (const id of regionIds) addTarget(id);
      if (targets.length === 0) targets.push(undefined);

      for (const target of targets) {
        const client = new Daytona(clientConfig(this.apiKey, this.apiUrl, target));
        const createArgs: {
          snapshot: string;
          language: string;
          labels: Record<string, string>;
          envVars: Record<string, string>;
          autoStopInterval: number;
          public: boolean;
          resources?: { cpu?: number; memory?: number; disk?: number };
        } = {
          snapshot: snapshotName,
          language: "typescript",
          labels: params.labels,
          envVars: params.envVars,
          autoStopInterval: 0,
          public: false,
        };
        if (params.cpu !== undefined || params.memoryGb !== undefined || params.diskGb !== undefined) {
          const resources: { cpu?: number; memory?: number; disk?: number } = {};
          if (params.cpu !== undefined) resources.cpu = params.cpu;
          if (params.memoryGb !== undefined) resources.memory = params.memoryGb;
          if (params.diskGb !== undefined) resources.disk = params.diskGb;
          createArgs.resources = resources;
        }
        try {
          const sandbox = (await client.create(
            createArgs,
            { timeout: 180 },
          )) as unknown as SdkSandbox;
          this.daytona = client;
          const session = new SdkDaytonaSandbox(sandbox, params.birdId, params.flockId);
          await session.ensureWorkspace();
          return session;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(
            `${snapshotName}@${target ?? "default"} class=${sandboxClass} regionIds=${regionIds.join(",") || "-"}: ${msg}`,
          );
          if (!/not available in region/i.test(msg)) {
            throw new ProviderUnavailable(
              "daytona",
              `${msg} (snapshot=${snapshotName} class=${sandboxClass} target=${target ?? "default"})`,
            );
          }
        }
      }
    }

    throw new ProviderUnavailable(
      "daytona",
      `Linux VM snapshot not provisionable from dashboard VM images. ${errors.join(" | ")}`,
    );
  }

  async get(id: string): Promise<DaytonaSandboxSession> {
    const sandbox = (await this.daytona.get(id)) as unknown as SdkSandbox;
    return new SdkDaytonaSandbox(sandbox, "unknown", "unknown");
  }

  async restore(
    snapshotRef: string,
    params: DaytonaCreateParams,
  ): Promise<DaytonaSandboxSession> {
    return this.create({ ...params, snapshot: snapshotRef });
  }
}

class SdkDaytonaSandbox implements DaytonaSandboxSession {
  readonly id: string;
  readonly birdId: string;
  readonly flockId: string;
  readonly bootId: string;
  readonly browserProfileId: string;
  private desktopReady = false;

  constructor(
    private readonly sandbox: SdkSandbox,
    birdId: string,
    flockId: string,
  ) {
    this.id = sandbox.id;
    this.birdId = birdId;
    this.flockId = flockId;
    this.bootId = sandbox.id;
    this.browserProfileId = `daytona-${sandbox.id}`;
  }

  async ensureWorkspace(): Promise<void> {
    await this.sandbox.fs.createFolder(DAYTONA_WORKSPACE_ROOT, "755").catch(() => undefined);
  }

  async state() {
    await this.sandbox.refreshData().catch(() => undefined);
    const raw = (this.sandbox.state ?? "started").toLowerCase();
    if (raw.includes("pause")) return "paused" as const;
    if (raw.includes("stop") || raw.includes("archiv")) {
      return raw.includes("archiv") ? ("archived" as const) : ("stopped" as const);
    }
    if (raw.includes("destroy") || raw.includes("delet")) return "destroyed" as const;
    if (raw.includes("error") || raw.includes("fail")) return "error" as const;
    return "started" as const;
  }

  async start(): Promise<void> {
    await this.sandbox.start(120);
  }

  async stop(): Promise<void> {
    await this.sandbox.stop(120);
  }

  async pause(): Promise<void> {
    await this.sandbox.pause(120);
  }

  async delete(): Promise<void> {
    await this.sandbox.delete(120, true);
  }

  async exec(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<DaytonaExecResult> {
    assertNoControlPlaneSecrets(req.env);
    const timeoutSec = Math.max(1, Math.ceil(req.timeoutMs / 1000));
    const env: Record<string, string> = {
      ...(req.env ?? {}),
      FLOK_EXEC_ARGV: JSON.stringify(req.argv),
    };
    assertNoControlPlaneSecrets(env);
    // argv never interpolated into the shell string.
    const wrapper =
      'python3 -c \'import json,os; a=json.loads(os.environ["FLOK_EXEC_ARGV"]); os.execvp(a[0], a)\'';
    try {
      const res = await this.sandbox.process.executeCommand(
        wrapper,
        req.cwd,
        env,
        timeoutSec,
      );
      return {
        exitCode: res.exitCode,
        stdout: res.result ?? "",
        stderr: "",
        timedOut: res.exitCode === 124,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/timeout/i.test(msg)) {
        return { exitCode: 124, stdout: "", stderr: msg, timedOut: true };
      }
      throw e;
    }
  }

  async fsStat(
    path: string,
  ): Promise<DaytonaFsResult<{ path: string; isDir: boolean; size: number }>> {
    try {
      const info = await this.sandbox.fs.getFileDetails(path);
      return {
        ok: true,
        data: { path, isDir: Boolean(info.isDir), size: Number(info.size) || 0 },
      };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsList(path: string): Promise<DaytonaFsResult<string[]>> {
    try {
      const files = await this.sandbox.fs.listFiles(path);
      return { ok: true, data: files.map((f) => f.name) };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsRead(path: string): Promise<DaytonaFsResult<Buffer>> {
    try {
      const buf = await this.sandbox.fs.downloadFile(path);
      return { ok: true, data: buf };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsWrite(path: string, body: Buffer): Promise<DaytonaFsResult> {
    try {
      await this.sandbox.fs.uploadFile(body, path);
      return { ok: true };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsMkdir(path: string): Promise<DaytonaFsResult> {
    try {
      await this.sandbox.fs.createFolder(path, "755");
      return { ok: true };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsDelete(path: string): Promise<DaytonaFsResult> {
    try {
      await this.sandbox.fs.deleteFile(path, true);
      return { ok: true };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsMove(from: string, to: string): Promise<DaytonaFsResult> {
    try {
      await this.sandbox.fs.moveFiles(from, to);
      return { ok: true };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async fsCopy(from: string, to: string): Promise<DaytonaFsResult> {
    try {
      const buf = await this.sandbox.fs.downloadFile(from);
      await this.sandbox.fs.uploadFile(buf, to);
      return { ok: true };
    } catch (e) {
      return { ok: false, errorCode: classifyFs(e) };
    }
  }

  async observe(request: ObserveRequest): Promise<Observation> {
    await this.ensureDesktop();
    const shot = request.includeScreenshot
      ? await this.sandbox.computerUse.screenshot.takeFullScreen()
      : undefined;
    const obs: Observation = {
      screenWidth: shot?.width ?? 0,
      screenHeight: shot?.height ?? 0,
    };
    if (shot?.screenshot) obs.screenshotBase64 = shot.screenshot;
    if (request.includeAccessibility && this.sandbox.computerUse.accessibility?.getTree) {
      obs.accessibilitySummary = await this.sandbox.computerUse.accessibility.getTree({
        scope: "focused",
        maxDepth: 2,
      });
    }
    return obs;
  }

  async act(request: ActionBatch): Promise<ActionResult> {
    await this.ensureDesktop();
    const results: ActionResult["results"] = [];
    for (const action of request.actions) {
      try {
        switch (action.type) {
          case "click_coordinates":
            await this.sandbox.computerUse.mouse.click(action.x ?? 0, action.y ?? 0);
            break;
          case "type":
            if (action.text) await this.sandbox.computerUse.keyboard.type(action.text);
            break;
          case "key":
            if (action.key) await this.sandbox.computerUse.keyboard.press(action.key);
            break;
          case "scroll":
            await this.sandbox.computerUse.mouse.scroll(
              action.x ?? 0,
              action.y ?? 0,
              "down",
              3,
            );
            break;
          default:
            results.push({
              action,
              success: false,
              error: `unsupported action ${action.type}`,
            });
            continue;
        }
        results.push({ action, success: true });
      } catch (e) {
        results.push({
          action,
          success: false,
          error: e instanceof Error ? e.message : "act failed",
        });
      }
    }
    return { ok: results.every((r) => r.success), results };
  }

  async takeover(): Promise<TakeoverGrant> {
    await this.ensureDesktop();
    const preview = await this.sandbox.getSignedPreviewUrl(6080, 60);
    return {
      url: preview.url,
      expiresAt: new Date(Date.now() + 60_000),
      singleUse: true,
    };
  }

  async checkpoint(name: string): Promise<string> {
    await this.sandbox.createSnapshot(name, 180);
    return name;
  }

  private async ensureDesktop(): Promise<void> {
    if (this.desktopReady) return;
    await this.sandbox.computerUse.start();
    this.desktopReady = true;
  }
}

function classifyFs(err: unknown): string {
  const s = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (s.includes("permission") || s.includes("denied") || s.includes("read-only")) {
    return "PERMISSION_DENIED";
  }
  if (s.includes("not found") || s.includes("no such") || s.includes("404")) {
    return "NOT_FOUND";
  }
  return "IO_ERROR";
}

/** Resolve a guest path inside /home/flok; used by live jail tests. */
export function jailDaytonaPath(userPath: string): string {
  return assertInsideRoot(userPath, DAYTONA_WORKSPACE_ROOT);
}

export function mustJail(userPath: string): string {
  try {
    return jailDaytonaPath(userPath);
  } catch (e) {
    if (e instanceof PathEscape) throw e;
    throw new PathEscape(userPath);
  }
}
