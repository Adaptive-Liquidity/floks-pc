/**
 * Domain types for Flok Node Computers.
 * Discriminated unions; no `any`.
 * bird_id / flock_id are opaque foreign keys (string) until post-G0 integration.
 */

/** Lifecycle states — illegal transitions must fail closed */
export type ComputerState =
  | "requested"
  | "provisioning"
  | "ready"
  | "running"
  | "paused"
  | "stopped"
  | "recovering"
  | "error"
  | "deleting"
  | "deleted";

/** Legal state transitions (source of truth for validation) */
export const LEGAL_TRANSITIONS: Readonly<Record<ComputerState, readonly ComputerState[]>> = {
  requested: ["provisioning", "error", "deleting"],
  provisioning: ["ready", "error", "deleting"],
  ready: ["running", "paused", "stopped", "error", "deleting"],
  running: ["paused", "stopped", "error", "deleting"],
  paused: ["running", "stopped", "error", "deleting"],
  stopped: ["running", "ready", "error", "deleting"],
  recovering: ["ready", "error", "deleting"],
  error: ["recovering", "deleting"],
  deleting: ["deleted"],
  deleted: [],
} as const;

export type OsType = "linux" | "windows";

/** Concrete providers currently implemented. Do not add a factory in C2. */
export type ComputerProviderName = "fake" | "docker-dev";

export interface ComputerSpec {
  birdId: string;
  flockId: string;
  osType?: OsType;
  computerClass?: string;
  cpu?: number;
  memoryMb?: number;
  diskGb?: number;
  baseImageVersion?: string;
}

export interface Computer {
  id: string;
  birdId: string;
  flockId: string;
  provider: ComputerProviderName;
  providerRef: string | null;
  state: ComputerState;
  osType: OsType;
  computerClass: string | null;
  cpu: number | null;
  memoryMb: number | null;
  diskGb: number | null;
  baseImageVersion: string | null;
  workspaceRevision: number;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderCapabilities {
  linuxVm: boolean;
  windowsVm: boolean;
  computerUse: boolean;
  accessibility: boolean;
  vnc: boolean;
  pauseMemory: boolean;
  snapshots: boolean;
  forks: boolean;
  customImages: boolean;
  networkPolicy: boolean;
}

export type ComputerJobType =
  | "provision"
  | "wake"
  | "pause"
  | "stop"
  | "checkpoint"
  | "restore"
  | "destroy";

export type ComputerJobStatus =
  | "pending"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ComputerJob {
  id: string;
  computerId: string;
  type: ComputerJobType;
  status: ComputerJobStatus;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  idempotencyKey: string;
  availableAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastErrorCode: string | null;
}

export interface ComputerCheckpoint {
  id: string;
  computerId: string;
  revision: number;
  providerSnapshotRef: string | null;
  workspaceObjectKey: string;
  sha256: string;
  baseImageVersion: string;
  sizeBytes: number;
  createdAt: Date;
}

export type HandoffStatus = "pending" | "accepted" | "expired" | "rejected";

export interface ComputerHandoff {
  id: string;
  sourceBirdId: string;
  destinationBirdId: string;
  artifactObjectKey: string;
  sha256: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: HandoffStatus;
  createdAt: Date;
  acceptedAt: Date | null;
  expiresAt: Date;
}

/** Metadata only — never terminal output, screenshots, cookies, page contents */
export interface ComputerAuditEvent {
  id: string;
  computerId: string;
  birdId: string;
  operation: string;
  targetClass: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  success: boolean;
  errorCode: string | null;
  traceId: string | null;
  receiptId: string | null;
}

export interface ComputerCapability {
  id: string;
  computerId: string;
  birdId: string;
  tokenDigest: string;
  scopes: string[];
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface ComputerPairCode {
  id: string;
  computerId: string;
  codeDigest: string;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
}

/** Provider-facing computer handle returned by provision */
export interface ProviderComputer {
  providerRef: string;
  status: ComputerState;
  endpoints?: Record<string, string>;
}

export interface ComputerStatus {
  state: ComputerState;
  lastActiveAt?: Date;
  providerDetail?: string;
}

export interface ExecRequest {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  mode?: "argv" | "shell";
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  operationHandle?: string;
}

export type FsOperation =
  | "stat"
  | "list"
  | "read"
  | "write"
  | "mkdir"
  | "move"
  | "copy"
  | "delete";

export interface FsRequest {
  operation: FsOperation;
  path: string;
  content?: string | Uint8Array;
  destination?: string;
  encoding?: "utf8" | "base64";
}

export interface FsResult {
  ok: boolean;
  data?: unknown;
  errorCode?: string;
}

export interface ObserveRequest {
  includeScreenshot?: boolean;
  includeAccessibility?: boolean;
}

export interface Observation {
  screenWidth: number;
  screenHeight: number;
  activeWindow?: string;
  screenshotBase64?: string;
  accessibilitySummary?: unknown;
}

export type ActionType =
  | "click_element"
  | "click_coordinates"
  | "type"
  | "key"
  | "scroll"
  | "open_url"
  | "launch_application"
  | "wait";

export interface Action {
  type: ActionType;
  elementId?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  url?: string;
  application?: string;
  durationMs?: number;
}

export interface ActionBatch {
  actions: Action[];
}

export interface ActionResult {
  ok: boolean;
  results: Array<{ action: Action; success: boolean; error?: string }>;
}

export interface TakeoverGrant {
  url: string;
  expiresAt: Date;
  singleUse: true;
}

export interface ProviderCheckpoint {
  providerSnapshotRef: string;
  workspaceObjectKey?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface RestoreRequest {
  computerId: string;
  checkpointId: string;
  providerSnapshotRef?: string;
  workspaceObjectKey?: string;
}
