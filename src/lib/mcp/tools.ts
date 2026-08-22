/**
 * The eight C5 MCP tools. Input schemas are Zod (runtime) + JSON Schema (tools/list).
 * Handoffs are listed so the surface is exactly eight tools, then fail closed (C9).
 */

import { z } from "zod";
import { ActionSchema, FsOperationSchema } from "../computers/schemas.js";
import { MCP_MAX_ARG_CHARS, MCP_MAX_ARGV } from "./config.js";

export const MCP_TOOL_NAMES = [
  "computer_pair",
  "computer_status",
  "computer_exec",
  "computer_fs",
  "computer_observe",
  "computer_act",
  "handoff_send",
  "handoff_receive",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export interface McpToolDefinition {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const capabilityToken = z.string().min(1).max(256).optional();
const handle = z.string().min(1).max(128);

export const ComputerPairArgsSchema = z.object({
  pair_code: z.string().min(1).max(32),
  bird_id: z.string().min(1).max(128),
  flock_id: z.string().min(1).max(128),
  account_id: z.string().min(1).max(128).optional(),
});

export const ComputerStatusArgsSchema = z.object({
  capability_token: capabilityToken,
  computer_handle: handle,
});

export const ComputerExecArgsSchema = z.object({
  capability_token: capabilityToken,
  computer_handle: handle,
  argv: z.array(z.string().max(MCP_MAX_ARG_CHARS)).min(1).max(MCP_MAX_ARGV),
  cwd: z.string().max(1024).optional(),
  env: z.record(z.string().max(128), z.string().max(4096)).optional(),
  timeout_ms: z.number().int().positive().max(600_000).optional(),
  mode: z.enum(["argv", "shell"]).optional(),
});

export const ComputerFsArgsSchema = z.object({
  capability_token: capabilityToken,
  computer_handle: handle,
  operation: FsOperationSchema,
  path: z.string().min(1).max(2048),
  content: z.string().max(1_000_000).optional(),
  destination: z.string().max(2048).optional(),
  encoding: z.enum(["utf8", "base64"]).optional(),
});

export const ComputerObserveArgsSchema = z.object({
  capability_token: capabilityToken,
  computer_handle: handle,
  include_screenshot: z.boolean().optional(),
});

export const ComputerActArgsSchema = z.object({
  capability_token: capabilityToken,
  computer_handle: handle,
  actions: z.array(ActionSchema).min(1).max(50),
});

export const HandoffArgsSchema = z.object({
  capability_token: capabilityToken,
  computer_handle: handle,
  filename: z.string().min(1).max(512).optional(),
});

function obj(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const tokenProp = {
  type: "string",
  minLength: 1,
  description: "Capability secret from computer_pair. Never log it.",
};
const handleProp = {
  type: "string",
  minLength: 1,
  description: "computer_handle from computer_pair.",
};

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "computer_pair",
    description:
      "Redeem a one-time pair code for a capability token bound to this Bot's computer/bird/flock. Account/MCP auth does not authorize pairing.",
    inputSchema: obj(
      {
        pair_code: { type: "string", minLength: 1, description: "One-time pair code (ABCD-EFGH-JK)." },
        bird_id: { type: "string", minLength: 1 },
        flock_id: { type: "string", minLength: 1 },
        account_id: {
          type: "string",
          description: "Optional shared-account metadata. Never sufficient for access.",
        },
      },
      ["pair_code", "bird_id", "flock_id"],
    ),
  },
  {
    name: "computer_status",
    description: "Return computer lifecycle state. Requires a valid capability with status scope.",
    inputSchema: obj(
      { capability_token: tokenProp, computer_handle: handleProp },
      ["capability_token", "computer_handle"],
    ),
  },
  {
    name: "computer_exec",
    description:
      "Run argv[] on the computer. Default mode is argv. mode=shell requires the shell scope (not granted by default pairing).",
    inputSchema: obj(
      {
        capability_token: tokenProp,
        computer_handle: handleProp,
        argv: { type: "array", items: { type: "string" }, minItems: 1 },
        cwd: { type: "string" },
        env: { type: "object", additionalProperties: { type: "string" } },
        timeout_ms: { type: "integer", minimum: 1, maximum: 600000 },
        mode: { type: "string", enum: ["argv", "shell"] },
      },
      ["capability_token", "computer_handle", "argv"],
    ),
  },
  {
    name: "computer_fs",
    description:
      "Filesystem operation inside the workspace jail (stat/list/read/write/mkdir/move/copy/delete). Path escape is rejected.",
    inputSchema: obj(
      {
        capability_token: tokenProp,
        computer_handle: handleProp,
        operation: {
          type: "string",
          enum: ["stat", "list", "read", "write", "mkdir", "move", "copy", "delete"],
        },
        path: { type: "string", minLength: 1 },
        content: { type: "string" },
        destination: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"] },
      },
      ["capability_token", "computer_handle", "operation", "path"],
    ),
  },
  {
    name: "computer_observe",
    description:
      "Observe the computer display. Screenshot only when include_screenshot is true. Accessibility is not fabricated.",
    inputSchema: obj(
      {
        capability_token: tokenProp,
        computer_handle: handleProp,
        include_screenshot: { type: "boolean" },
      },
      ["capability_token", "computer_handle"],
    ),
  },
  {
    name: "computer_act",
    description:
      "Apply a bounded action batch (click_coordinates/type/key/scroll/open_url/launch_application/wait). No public VNC/takeover.",
    inputSchema: obj(
      {
        capability_token: tokenProp,
        computer_handle: handleProp,
        actions: { type: "array", minItems: 1, maxItems: 50, items: { type: "object" } },
      },
      ["capability_token", "computer_handle", "actions"],
    ),
  },
  {
    name: "handoff_send",
    description:
      "Send an explicit file handoff to another Node. Not implemented in C5 (Gate C9). Fails closed.",
    inputSchema: obj(
      {
        capability_token: tokenProp,
        computer_handle: handleProp,
        filename: { type: "string" },
      },
      ["capability_token", "computer_handle"],
    ),
  },
  {
    name: "handoff_receive",
    description:
      "Receive an explicit file handoff. Not implemented in C5 (Gate C9). Fails closed.",
    inputSchema: obj(
      {
        capability_token: tokenProp,
        computer_handle: handleProp,
        filename: { type: "string" },
      },
      ["capability_token", "computer_handle"],
    ),
  },
];

export function toolsListResult(): Record<string, unknown> {
  return {
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    ttlMs: 3_600_000,
    cacheScope: "public",
  };
}
