/**
 * Zod schemas mirroring the domain types.
 * All external / runtime validation goes through these.
 */

import { z } from "zod";
import {
  MCP_MAX_ARGV,
  MCP_MAX_ARG_CHARS,
  MCP_MAX_ENV_KEYS,
} from "../mcp/config.js";

export const ComputerStateSchema = z.enum([
  "requested",
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopped",
  "waking",
  "checkpointing",
  "recovering",
  "restore_failed",
  "recovery_failed",
  "cleanup_needed",
  "error",
  "deleting",
  "deleted",
]);

export const CheckpointStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
  "restoring",
  "restored",
]);

export const ComputerLatestCheckpointSchema = z.object({
  id: z.string().min(1).max(128),
  providerSnapshotRef: z.string().min(1).max(256),
  createdAt: z.coerce.date(),
  status: CheckpointStatusSchema,
});

export const OsTypeSchema = z.enum(["linux", "windows"]);

export const CapabilityScopeSchema = z.enum([
  "status",
  "exec",
  "fs",
  "observe",
  "act",
  "lifecycle",
  "shell",
]);

export const SharedAccountAuthSchema = z.object({
  accountId: z.string().min(1),
});

export const ComputerOperationAuthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("capability"), token: z.string().min(1) }),
  z.object({ kind: z.literal("shared"), accountId: z.string().min(1) }),
  z.object({ kind: z.literal("none") }),
]);

export const NodeIdentitySchema = z.object({
  birdId: z.string().min(1),
  flockId: z.string().min(1),
});

export const ComputerSpecSchema = z.object({
  birdId: z.string().min(1),
  flockId: z.string().min(1),
  osType: OsTypeSchema.optional(),
  computerClass: z.string().optional(),
  cpu: z.number().int().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  diskGb: z.number().int().positive().optional(),
  baseImageVersion: z.string().optional(),
});

export const ComputerSchema = z.object({
  id: z.string().min(1),
  birdId: z.string().min(1),
  flockId: z.string().min(1),
  provider: z.enum(["fake", "docker-dev", "runloop"]),
  providerRef: z.string().nullable(),
  state: ComputerStateSchema,
  osType: OsTypeSchema,
  computerClass: z.string().nullable(),
  cpu: z.number().int().nullable(),
  memoryMb: z.number().int().nullable(),
  diskGb: z.number().int().nullable(),
  baseImageVersion: z.string().nullable(),
  workspaceRevision: z.number().int().nonnegative(),
  lastActiveAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  latestCheckpoint: ComputerLatestCheckpointSchema.nullable().default(null),
  recoveryNote: z.string().max(512).nullable().default(null),
});

export const ProviderCapabilitiesSchema = z.object({
  linuxVm: z.boolean(),
  windowsVm: z.boolean(),
  computerUse: z.boolean(),
  accessibility: z.boolean(),
  vnc: z.boolean(),
  pauseMemory: z.boolean(),
  snapshots: z.boolean(),
  forks: z.boolean(),
  customImages: z.boolean(),
  networkPolicy: z.boolean(),
});

export const ComputerJobTypeSchema = z.enum([
  "provision",
  "wake",
  "pause",
  "stop",
  "checkpoint",
  "restore",
  "destroy",
]);

export const ComputerJobStatusSchema = z.enum([
  "pending",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ExecRequestSchema = z.object({
  argv: z
    .array(z.string().max(MCP_MAX_ARG_CHARS))
    .min(1)
    .max(MCP_MAX_ARGV),
  cwd: z.string().max(1024).optional(),
  env: z
    .record(z.string().max(128), z.string().max(4096))
    .optional()
    .refine((env) => !env || Object.keys(env).length <= MCP_MAX_ENV_KEYS, {
      message: `env must have at most ${MCP_MAX_ENV_KEYS} keys`,
    }),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  mode: z.enum(["argv", "shell"]).optional(),
});

export const FsOperationSchema = z.enum([
  "stat",
  "list",
  "read",
  "write",
  "mkdir",
  "move",
  "copy",
  "delete",
]);

export const FsRequestSchema = z.object({
  operation: FsOperationSchema,
  path: z.string().min(1),
  content: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
  destination: z.string().optional(),
  encoding: z.enum(["utf8", "base64"]).optional(),
});

export const ActionTypeSchema = z.enum([
  "click_element",
  "click_coordinates",
  "type",
  "key",
  "scroll",
  "open_url",
  "launch_application",
  "wait",
]);

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  elementId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  url: z.string().url().optional(),
  application: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
});

export const ActionBatchSchema = z.object({
  actions: z.array(ActionSchema).min(1).max(50),
});

export const ComputerCapabilitySchema = z.object({
  id: z.string().min(1),
  computerId: z.string().min(1),
  birdId: z.string().min(1),
  flockId: z.string().min(1),
  tokenDigest: z.string().min(1),
  scopes: z.array(CapabilityScopeSchema),
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
});

export const ComputerPairCodeSchema = z.object({
  id: z.string().min(1),
  computerId: z.string().min(1),
  birdId: z.string().min(1),
  flockId: z.string().min(1),
  codeDigest: z.string().min(1),
  expiresAt: z.coerce.date(),
  usedAt: z.coerce.date().nullable(),
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
});
