/**
 * ComputerProvider — the only public contract that talks to compute.
 *
 * Routes and MCP tools must never call a concrete provider directly.
 * They call ComputerService, which calls this interface.
 *
 * Implementations: Fake (tests), DockerDev (local), Daytona (prod v1),
 * Kata (self-host later).
 */

import type {
  ActionBatch,
  ActionResult,
  ComputerProviderName,
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

export interface ComputerProvider {
  /** Identity of the injected implementation. ComputerService records this. */
  readonly name: ComputerProviderName;

  /** Static capability advertisement */
  capabilities(): ProviderCapabilities;

  /** Create a new computer (VM / container) for a Node */
  provision(spec: ComputerSpec): Promise<ProviderComputer>;

  /** Current status of an existing computer */
  status(ref: string): Promise<ComputerStatus>;

  /** Bring a paused / stopped computer back to running */
  wake(ref: string): Promise<void>;

  /** Pause (preferably memory-preserving) */
  pause(ref: string): Promise<void>;

  /** Stop (filesystem preserved, memory may be discarded) */
  stop(ref: string): Promise<void>;

  /** Irreversible destroy */
  destroy(ref: string): Promise<void>;

  /** Execute a process (prefer argv[] over shell strings) */
  exec(ref: string, request: ExecRequest): Promise<ExecResult>;

  /** Filesystem operations (path-canonicalized + root-jailed by service) */
  filesystem(ref: string, request: FsRequest): Promise<FsResult>;

  /** Observe desktop (screenshot, accessibility tree) */
  observe(ref: string, request: ObserveRequest): Promise<Observation>;

  /** Perform a batch of UI actions */
  act(ref: string, request: ActionBatch): Promise<ActionResult>;

  /** Issue a short-lived, single-use human takeover (VNC) grant */
  takeover(ref: string): Promise<TakeoverGrant>;

  /** Create a provider-level checkpoint / snapshot */
  checkpoint(ref: string): Promise<ProviderCheckpoint>;

  /** Restore from a checkpoint (may provision a replacement machine) */
  restore(request: RestoreRequest): Promise<ProviderComputer>;
}
