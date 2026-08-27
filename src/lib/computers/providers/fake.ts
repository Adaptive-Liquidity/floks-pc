/**
 * FakeProvider — deterministic in-memory ComputerProvider for unit/contract tests.
 * Supports failure injection. Zero network, zero Docker, zero real VMs.
 */

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
import { ProviderUnavailable, PathEscape } from "../errors.js";
import {
  canonicalizeWorkspacePath,
  getDefaultWorkspaceRoot,
  workspaceRootForProvider,
} from "../path.js";

type FailureMode =
  | "timeout"
  | "unavailable"
  | "snapshot_failure"
  | "disk_full"
  | "computer_disappeared";

interface VirtualFile {
  content: string | Uint8Array;
  isDir: boolean;
}

interface FakeMachine {
  ref: string;
  birdId: string;
  flockId: string;
  state: "ready" | "running" | "paused" | "stopped" | "deleted";
  fs: Map<string, VirtualFile>;
  lastUrl: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

export class FakeProvider implements ComputerProvider {
  readonly name = "fake" as const;
  private machines = new Map<string, FakeMachine>();
  private snapshots = new Map<
    string,
    { birdId: string; flockId: string; fs: Map<string, VirtualFile> }
  >();
  private failures = new Map<string, FailureMode>();
  private seq = 0;

  /** Inject a deterministic failure for the next call to `method`. Cleared after use. */
  injectFailure(method: string, mode: FailureMode): void {
    this.failures.set(method, mode);
  }

  /** Clear all injected failures and all machines (for test isolation). */
  reset(): void {
    this.machines.clear();
    this.snapshots.clear();
    this.failures.clear();
    this.seq = 0;
  }

  private cloneFs(fs: Map<string, VirtualFile>): Map<string, VirtualFile> {
    const out = new Map<string, VirtualFile>();
    for (const [key, value] of fs) {
      out.set(key, {
        isDir: value.isDir,
        content:
          typeof value.content === "string"
            ? value.content
            : Uint8Array.from(value.content),
      });
    }
    return out;
  }

  private maybeFail(method: string): void {
    const mode = this.failures.get(method);
    if (!mode) return;
    this.failures.delete(method);
    switch (mode) {
      case "timeout":
        throw new ProviderUnavailable("fake", "timeout");
      case "unavailable":
        throw new ProviderUnavailable("fake", "provider unavailable");
      case "snapshot_failure":
        throw new ProviderUnavailable("fake", "snapshot failure");
      case "disk_full":
        throw new ProviderUnavailable("fake", "disk full");
      case "computer_disappeared":
        throw new ProviderUnavailable("fake", "computer disappeared");
    }
  }

  private getMachine(ref: string): FakeMachine {
    const m = this.machines.get(ref);
    if (!m || m.state === "deleted") {
      throw new ProviderUnavailable("fake", `computer ${ref} not found`);
    }
    return m;
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
      forks: false,
      customImages: true,
      networkPolicy: false,
    };
  }

  async provision(spec: ComputerSpec): Promise<ProviderComputer> {
    this.maybeFail("provision");
    this.seq += 1;
    const ref = `fake-${this.seq}-${randomBytes(4).toString("hex")}`;
    const now = new Date();
    const root = getDefaultWorkspaceRoot();
    const fs = new Map<string, VirtualFile>();
    fs.set(root, { content: "", isDir: true });
    fs.set(`${root}/workspace`, { content: "", isDir: true });

    const machine: FakeMachine = {
      ref,
      birdId: spec.birdId,
      flockId: spec.flockId,
      state: "ready",
      fs,
      lastUrl: null,
      createdAt: now,
      lastActiveAt: now,
    };
    this.machines.set(ref, machine);

    return {
      providerRef: ref,
      status: "ready",
    };
  }

  async status(ref: string): Promise<ComputerStatus> {
    this.maybeFail("status");
    const m = this.getMachine(ref);
    return {
      state: m.state === "ready" ? "ready" : m.state,
      lastActiveAt: m.lastActiveAt,
      providerDetail: `fake:${m.birdId}`,
    };
  }

  async wake(ref: string): Promise<void> {
    this.maybeFail("wake");
    const m = this.getMachine(ref);
    if (m.state === "paused" || m.state === "stopped") {
      m.state = "running";
      m.lastActiveAt = new Date();
    }
  }

  async pause(ref: string): Promise<void> {
    this.maybeFail("pause");
    const m = this.getMachine(ref);
    if (m.state === "running" || m.state === "ready") {
      m.state = "paused";
    }
  }

  async stop(ref: string): Promise<void> {
    this.maybeFail("stop");
    const m = this.getMachine(ref);
    m.state = "stopped";
  }

  async destroy(ref: string): Promise<void> {
    this.maybeFail("destroy");
    const m = this.machines.get(ref);
    if (m) {
      m.state = "deleted";
      m.fs.clear();
    }
  }

  async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    this.maybeFail("exec");
    const m = this.getMachine(ref);
    m.lastActiveAt = new Date();
    // Deterministic stub: echo the argv
    const stdout = `fake-exec: ${request.argv.join(" ")}\n`;
    return {
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
    };
  }

  async filesystem(ref: string, request: FsRequest): Promise<FsResult> {
    this.maybeFail("filesystem");
    const m = this.getMachine(ref);
    m.lastActiveAt = new Date();
    const root = workspaceRootForProvider("fake");

    let canonical: string;
    try {
      canonical = canonicalizeWorkspacePath(request.path, root);
    } catch (e) {
      if (e instanceof PathEscape) {
        return { ok: false, errorCode: "PATH_ESCAPE" };
      }
      throw e;
    }

    switch (request.operation) {
      case "stat": {
        const entry = m.fs.get(canonical);
        if (!entry) return { ok: false, errorCode: "NOT_FOUND" };
        return {
          ok: true,
          data: {
            path: canonical,
            isDir: entry.isDir,
            size: typeof entry.content === "string"
              ? entry.content.length
              : entry.content.byteLength,
          },
        };
      }
      case "list": {
        const prefix = canonical.endsWith("/") ? canonical : canonical + "/";
        const children: string[] = [];
        for (const key of m.fs.keys()) {
          if (key.startsWith(prefix)) {
            const rest = key.slice(prefix.length);
            const segment = rest.split("/")[0];
            if (segment && !children.includes(segment)) children.push(segment);
          }
        }
        return { ok: true, data: children };
      }
      case "read": {
        const entry = m.fs.get(canonical);
        if (!entry || entry.isDir) return { ok: false, errorCode: "NOT_FOUND" };
        const content =
          typeof entry.content === "string"
            ? entry.content
            : Buffer.from(entry.content).toString(
                request.encoding === "base64" ? "base64" : "utf8",
              );
        return { ok: true, data: content };
      }
      case "write": {
        if (request.content === undefined) {
          return { ok: false, errorCode: "MISSING_CONTENT" };
        }
        // Ensure parent dir exists
        const parent = canonical.slice(0, canonical.lastIndexOf("/")) || root;
        if (!m.fs.has(parent)) {
          m.fs.set(parent, { content: "", isDir: true });
        }
        m.fs.set(canonical, {
          content: request.content,
          isDir: false,
        });
        return { ok: true };
      }
      case "mkdir": {
        m.fs.set(canonical, { content: "", isDir: true });
        return { ok: true };
      }
      case "delete": {
        if (canonical === root) {
          return { ok: false, errorCode: "PATH_ESCAPE" };
        }
        m.fs.delete(canonical);
        for (const key of [...m.fs.keys()]) {
          if (key.startsWith(canonical + "/")) m.fs.delete(key);
        }
        return { ok: true };
      }
      case "move":
      case "copy": {
        if (!request.destination) {
          return { ok: false, errorCode: "MISSING_DESTINATION" };
        }
        let dest: string;
        try {
          dest = canonicalizeWorkspacePath(request.destination, root);
        } catch (e) {
          if (e instanceof PathEscape) {
            return { ok: false, errorCode: "PATH_ESCAPE" };
          }
          throw e;
        }
        const src = m.fs.get(canonical);
        if (!src) return { ok: false, errorCode: "NOT_FOUND" };
        if (dest === canonical) {
          return { ok: true };
        }
        m.fs.set(dest, { ...src });
        if (request.operation === "move") m.fs.delete(canonical);
        return { ok: true };
      }
      default:
        return { ok: false, errorCode: "UNSUPPORTED" };
    }
  }

  async observe(ref: string, _request: ObserveRequest): Promise<Observation> {
    this.maybeFail("observe");
    const m = this.getMachine(ref);
    return {
      screenWidth: 1280,
      screenHeight: 720,
      activeWindow: m.lastUrl ?? "Fake Desktop",
      accessibilitySummary: { nodes: 0 },
    };
  }

  async act(ref: string, request: ActionBatch): Promise<ActionResult> {
    this.maybeFail("act");
    const m = this.getMachine(ref);
    const root = workspaceRootForProvider("fake");
    const results: ActionResult["results"] = request.actions.map((action) => {
      if (action.type === "click_element") {
        return {
          action,
          success: false,
          error: "click_element unsupported until accessibility addressing exists",
        };
      }
      if (action.type === "open_url") {
        if (typeof action.url !== "string" || action.url.length === 0) {
          return {
            action,
            success: false,
            error: "open_url requires url",
          };
        }
        m.lastUrl = action.url;
        m.fs.set(`${root}/.browser`, { content: "", isDir: true });
        m.fs.set(`${root}/.browser/profile`, { content: "", isDir: true });
        m.fs.set(`${root}/.browser/profile/c7-marker`, {
          content: action.url,
          isDir: false,
        });
        return { action, success: true };
      }
      return { action, success: true };
    });
    return {
      ok: results.every((row) => row.success),
      results,
    };
  }

  async takeover(ref: string): Promise<TakeoverGrant> {
    this.maybeFail("takeover");
    this.getMachine(ref);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    return {
      url: `https://fake-vnc.local/session/${ref}?token=fake`,
      expiresAt,
      singleUse: true,
    };
  }

  async checkpoint(ref: string): Promise<ProviderCheckpoint> {
    this.maybeFail("checkpoint");
    const m = this.getMachine(ref);
    this.seq += 1;
    const snapshotRef = `snap-${this.seq}-${randomBytes(4).toString("hex")}`;
    this.snapshots.set(snapshotRef, {
      birdId: m.birdId,
      flockId: m.flockId,
      fs: this.cloneFs(m.fs),
    });
    return { providerSnapshotRef: snapshotRef };
  }

  async restore(request: RestoreRequest): Promise<ProviderComputer> {
    this.maybeFail("restore");
    const snapshotRef = request.providerSnapshotRef;
    if (!snapshotRef) {
      throw new ProviderUnavailable("fake", "providerSnapshotRef required");
    }
    const snap = this.snapshots.get(snapshotRef);
    if (!snap) {
      throw new ProviderUnavailable("fake", "checkpoint not found");
    }
    this.seq += 1;
    const ref = `fake-restored-${this.seq}-${randomBytes(4).toString("hex")}`;
    const now = new Date();
    this.machines.set(ref, {
      ref,
      birdId: request.birdId ?? snap.birdId,
      flockId: request.flockId ?? snap.flockId,
      state: "ready",
      fs: this.cloneFs(snap.fs),
      lastUrl: null,
      createdAt: now,
      lastActiveAt: now,
    });
    return { providerRef: ref, status: "ready" };
  }

  async healthProbe(ref: string): Promise<void> {
    this.maybeFail("healthProbe");
    const m = this.getMachine(ref);
    if (m.state === "paused" || m.state === "stopped" || m.state === "deleted") {
      throw new ProviderUnavailable("fake", `health probe failed: ${m.state}`);
    }
  }
}
