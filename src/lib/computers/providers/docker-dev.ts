/**
 * DockerDevProvider — local-integration ComputerProvider.
 * One container + one named volume per Node. DEV ONLY.
 * Forbidden when NODE_ENV=production. Not a production isolation boundary
 * (shared kernel). Production isolation is a VM (Daytona / later Kata).
 *
 * Zero extra deps: docker CLI via argv[] only. No shell interpolation.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import { ComputerError, ProviderUnavailable, PathEscape } from "../errors.js";
import { assertInsideRoot } from "../path.js";

export const DOCKER_DEV_IMAGE = "flok-computer-dev:0.0.1";
export const DOCKER_DEV_WORKSPACE_ROOT = "/workspace";

export class DockerDevForbiddenInProduction extends ComputerError {
  constructor() {
    super(
      "PROVIDER_FORBIDDEN_IN_PRODUCTION",
      "DockerDevProvider is local-integration only; forbidden when NODE_ENV=production",
    );
    this.name = "DockerDevForbiddenInProduction";
  }
}

interface DockerHandle {
  ref: string;
  container: string;
  volume: string;
  birdId: string;
  flockId: string;
}

interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function isUnpinnedImage(image: string): boolean {
  const tag = image.split("/").pop() ?? image;
  return image === "latest" || image.endsWith(":latest") || tag === "latest";
}

export class DockerDevProvider implements ComputerProvider {
  private readonly image: string;
  private readonly dockerBin: string;
  private readonly machines = new Map<string, DockerHandle>();
  private seq = 0;

  constructor(opts?: { image?: string; dockerBin?: string }) {
    if (process.env.NODE_ENV === "production") {
      throw new DockerDevForbiddenInProduction();
    }
    const image = opts?.image ?? process.env.FLOK_DOCKER_DEV_IMAGE ?? DOCKER_DEV_IMAGE;
    if (!image || isUnpinnedImage(image)) {
      throw new ComputerError(
        "IMAGE_PIN_REQUIRED",
        `refusing unpinned image: ${image}`,
      );
    }
    this.image = image;
    this.dockerBin = opts?.dockerBin ?? "docker";
  }

  capabilities(): ProviderCapabilities {
    return {
      linuxVm: false,
      windowsVm: false,
      computerUse: false,
      accessibility: false,
      vnc: false,
      pauseMemory: false,
      snapshots: true,
      forks: false,
      customImages: true,
      networkPolicy: true,
    };
  }

  async provision(spec: ComputerSpec): Promise<ProviderComputer> {
    if (spec.osType === "windows") {
      throw new ProviderUnavailable("docker-dev", "linux only");
    }
    this.seq += 1;
    const ref = `ddev-${this.seq}-${randomBytes(4).toString("hex")}`;
    const container = `flok-node-${ref}`;
    const volume = `flok-ws-${ref}`;
    let volumeCreated = false;

    try {
      await this.docker(["volume", "create",
        "--label", "flok.provider=docker-dev",
        "--label", `flok.bird_id=${spec.birdId}`,
        "--label", `flok.provider_ref=${ref}`,
        volume,
      ]);
      volumeCreated = true;

      // Ensure the volume is writable by uid 1000 before the read-only rootfs run.
      await this.docker([
        "run", "--rm",
        "-u", "0",
        "--mount", `type=volume,src=${volume},dst=/workspace`,
        this.image,
        "chown", "1000:1000", "/workspace",
      ]);

      await this.docker([
        "run", "-d",
        "--name", container,
        "--label", "flok.provider=docker-dev",
        "--label", `flok.bird_id=${spec.birdId}`,
        "--label", `flok.flock_id=${spec.flockId}`,
        "--label", `flok.provider_ref=${ref}`,
        "--network", "none",
        "--read-only",
        "--tmpfs", "/tmp",
        "--tmpfs", "/run",
        "--mount", `type=volume,src=${volume},dst=${DOCKER_DEV_WORKSPACE_ROOT}`,
        "--user", "1000:1000",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", "512m",
        "--cpus", "1",
        "--restart", "no",
        "--init",
        this.image,
        "sleep", "infinity",
      ]);
    } catch (err) {
      await this.docker(["rm", "-f", container]).catch(() => undefined);
      if (volumeCreated) {
        await this.docker(["volume", "rm", volume]).catch(() => undefined);
      }
      throw err;
    }

    this.machines.set(ref, {
      ref,
      container,
      volume,
      birdId: spec.birdId,
      flockId: spec.flockId,
    });

    return { providerRef: ref, status: "ready" };
  }

  async status(ref: string): Promise<ComputerStatus> {
    const h = await this.requireHandle(ref);
    const inspect = await this.docker([
      "inspect",
      "-f", "{{.State.Status}} {{.State.Paused}}",
      h.container,
    ]);
    const parts = inspect.stdout.trim().split(/\s+/);
    const dockerState = parts[0] ?? "";
    const paused = parts[1] === "true";
    let state: ComputerStatus["state"];
    if (paused) state = "paused";
    else if (dockerState === "running") state = "running";
    else if (dockerState === "exited" || dockerState === "dead" || dockerState === "created") {
      state = "stopped";
    } else {
      state = "error";
    }
    return { state, providerDetail: `docker-dev:${h.birdId}` };
  }

  async wake(ref: string): Promise<void> {
    const h = await this.requireHandle(ref);
    const cur = await this.status(ref);
    if (cur.state === "paused") {
      await this.docker(["unpause", h.container]);
    } else if (cur.state === "stopped") {
      await this.docker(["start", h.container]);
    }
  }

  async pause(ref: string): Promise<void> {
    const h = await this.requireHandle(ref);
    await this.docker(["pause", h.container]);
  }

  async stop(ref: string): Promise<void> {
    const h = await this.requireHandle(ref);
    await this.docker(["stop", h.container]);
  }

  async destroy(ref: string): Promise<void> {
    const h = this.machines.get(ref);
    const container = h?.container ?? `flok-node-${ref}`;
    const volume = h?.volume ?? `flok-ws-${ref}`;
    await this.docker(["rm", "-f", container]).catch(() => undefined);
    await this.docker(["volume", "rm", volume]).catch(() => undefined);
    this.machines.delete(ref);
  }

  async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    const h = await this.requireHandle(ref);
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
    const args = ["exec"];
    const cwd = request.cwd
      ? assertInsideRoot(request.cwd, DOCKER_DEV_WORKSPACE_ROOT)
      : DOCKER_DEV_WORKSPACE_ROOT;
    args.push("-w", cwd);
    if (request.env) {
      for (const [k, v] of Object.entries(request.env)) {
        args.push("-e", `${k}=${v}`);
      }
    }
    args.push(h.container, ...request.argv);
    const timeoutMs = Math.min(request.timeoutMs ?? 30_000, 600_000);
    const result = await this.docker(args, { timeoutMs, allowNonZero: true });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  }

  async filesystem(ref: string, request: FsRequest): Promise<FsResult> {
    const h = await this.requireHandle(ref);
    let canonical: string;
    try {
      canonical = assertInsideRoot(request.path, DOCKER_DEV_WORKSPACE_ROOT);
    } catch (e) {
      if (e instanceof PathEscape) return { ok: false, errorCode: "PATH_ESCAPE" };
      throw e;
    }

    switch (request.operation) {
      case "stat": {
        const r = await this.docker(
          ["exec", h.container, "stat", "-c", "%F %s", canonical],
          { allowNonZero: true },
        );
        if (r.exitCode !== 0) return { ok: false, errorCode: "NOT_FOUND" };
        const [kind, sizeStr] = r.stdout.trim().split(/\s+/);
        return {
          ok: true,
          data: {
            path: canonical,
            isDir: (kind ?? "").includes("directory"),
            size: Number(sizeStr ?? 0),
          },
        };
      }
      case "list": {
        const r = await this.docker(
          ["exec", h.container, "ls", "-1", canonical],
          { allowNonZero: true },
        );
        if (r.exitCode !== 0) return { ok: false, errorCode: "NOT_FOUND" };
        const children = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
        return { ok: true, data: children };
      }
      case "read": {
        const r = await this.docker(
          ["exec", h.container, "cat", canonical],
          { allowNonZero: true },
        );
        if (r.exitCode !== 0) return { ok: false, errorCode: "NOT_FOUND" };
        const data =
          request.encoding === "base64"
            ? Buffer.from(r.stdout, "utf8").toString("base64")
            : r.stdout;
        return { ok: true, data };
      }
      case "write": {
        if (request.content === undefined) {
          return { ok: false, errorCode: "MISSING_CONTENT" };
        }
        const body =
          typeof request.content === "string"
            ? request.content
            : Buffer.from(request.content);
        const r = await this.docker(
          ["exec", "-i", h.container, "tee", canonical],
          { stdin: body, allowNonZero: true },
        );
        if (r.exitCode !== 0) return { ok: false, errorCode: "NOT_FOUND" };
        return { ok: true };
      }
      case "mkdir": {
        const r = await this.docker(
          ["exec", h.container, "mkdir", "-p", canonical],
          { allowNonZero: true },
        );
        if (r.exitCode !== 0) return { ok: false, errorCode: "UNSUPPORTED" };
        return { ok: true };
      }
      case "delete": {
        const r = await this.docker(
          ["exec", h.container, "rm", "-rf", canonical],
          { allowNonZero: true },
        );
        if (r.exitCode !== 0) return { ok: false, errorCode: "NOT_FOUND" };
        return { ok: true };
      }
      case "move":
      case "copy": {
        if (!request.destination) {
          return { ok: false, errorCode: "MISSING_DESTINATION" };
        }
        let dest: string;
        try {
          dest = assertInsideRoot(request.destination, DOCKER_DEV_WORKSPACE_ROOT);
        } catch {
          return { ok: false, errorCode: "PATH_ESCAPE" };
        }
        const cmd = request.operation === "move" ? "mv" : "cp";
        const cpArgs =
          cmd === "cp"
            ? ["exec", h.container, "cp", "-a", canonical, dest]
            : ["exec", h.container, "mv", canonical, dest];
        const r = await this.docker(cpArgs, { allowNonZero: true });
        if (r.exitCode !== 0) return { ok: false, errorCode: "NOT_FOUND" };
        return { ok: true };
      }
      default:
        return { ok: false, errorCode: "UNSUPPORTED" };
    }
  }

  async observe(ref: string, _request: ObserveRequest): Promise<Observation> {
    await this.requireHandle(ref);
    return { screenWidth: 0, screenHeight: 0 };
  }

  async act(ref: string, request: ActionBatch): Promise<ActionResult> {
    await this.requireHandle(ref);
    return {
      ok: false,
      results: request.actions.map((action) => ({
        action,
        success: false,
        error: "computer-use not available on DockerDevProvider",
      })),
    };
  }

  async takeover(ref: string): Promise<TakeoverGrant> {
    await this.requireHandle(ref);
    throw new ProviderUnavailable("docker-dev", "VNC takeover not available");
  }

  async checkpoint(ref: string): Promise<ProviderCheckpoint> {
    const h = await this.requireHandle(ref);
    return { providerSnapshotRef: h.volume };
  }

  async restore(_request: RestoreRequest): Promise<ProviderComputer> {
    throw new ProviderUnavailable("docker-dev", "restore not implemented in C2");
  }

  private async requireHandle(ref: string): Promise<DockerHandle> {
    const existing = this.machines.get(ref);
    if (existing) return existing;
    // Rediscover by label if the process map is cold.
    const ps = await this.docker(
      ["ps", "-a", "--filter", `label=flok.provider_ref=${ref}`, "--format", "{{.Names}}"],
      { allowNonZero: true },
    );
    const name = ps.stdout.trim().split("\n")[0];
    if (!name) {
      throw new ProviderUnavailable("docker-dev", `computer ${ref} not found`);
    }
    const handle: DockerHandle = {
      ref,
      container: name,
      volume: `flok-ws-${ref}`,
      birdId: "unknown",
      flockId: "unknown",
    };
    this.machines.set(ref, handle);
    return handle;
  }

  private docker(
    args: string[],
    opts: {
      stdin?: string | Uint8Array;
      timeoutMs?: number;
      allowNonZero?: boolean;
    } = {},
  ): Promise<DockerResult> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    return new Promise((resolve, reject) => {
      const child = spawn(this.dockerBin, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (c: Buffer) => stdout.push(c));
      child.stderr.on("data", (c: Buffer) => stderr.push(c));

      if (opts.stdin !== undefined) {
        child.stdin.end(
          typeof opts.stdin === "string" ? opts.stdin : Buffer.from(opts.stdin),
        );
      } else {
        child.stdin.end();
      }

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new ProviderUnavailable("docker-dev", err.message));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const result: DockerResult = {
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
        };
        if (!opts.allowNonZero && result.exitCode !== 0) {
          reject(
            new ProviderUnavailable(
              "docker-dev",
              result.stderr.trim() || `docker ${args[0]} exit ${result.exitCode}`,
            ),
          );
          return;
        }
        resolve(result);
      });
    });
  }
}
