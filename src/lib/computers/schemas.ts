/**
 * Zod schemas mirroring the domain types.
 * All external / runtime validation goes through these.
 */

import { z } from "zod";

export const ComputerStateSchema = z.enum([
  "requested",
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopped",
  "recovering",
  "error",
  "deleting",
  "deleted",
]);

export const OsTypeSchema = z.enum(["linux", "windows"]);

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
  provider: z.string().min(1),
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
  argv: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
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
