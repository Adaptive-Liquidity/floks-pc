/**
 * The eight MCP tools. Input schemas are Zod (runtime) + JSON Schema (tools/list).
 * Handoffs stay listed so the surface is exactly eight tools, and then fail closed.
 */

import { z } from "zod";
import { ActionSchema, FsOperationSchema } from "../computers/schemas.js";
import { MCP_MAX_ARG_CHARS, MCP_MAX_ARGV, MCP_MAX_ENV_KEYS } from "./config.js";

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

const capabilityToken = z
  .string()
  .min(1)
  .max(256)
  .optional()
  .describe("Capability secret from computer_pair. Never log it.");
const handle = z
  .string()
  .min(1)
  .max(128)
  .optional()
  .describe("computer_handle from computer_pair. Ignored when this Bot is already bound.");

export const ComputerPairArgsSchema = z.object({
  pair_code: z.string().min(1).max(32).optional().describe("One-time pair code (ABCD-EFGH-JK)."),
  capability_token: capabilityToken,
  computer_handle: handle,
  bird_id: z.string().min(1).max(128).optional(),
  flock_id: z.string().min(1).max(128).optional(),
  account_id: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe("Optional shared-account metadata. Never sufficient for access."),
  plan: z
    .enum(["personal", "pro", "team"])
    .optional()
    .describe("Checkout plan when this Bot has no computer yet. Defaults to personal."),
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
  include_accessibility: z
    .boolean()
    .optional()
    .describe("When true, request a live accessibility summary. Never fabricated."),
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

function advertisedSchema(
  schema: z.ZodType,
  required: string[],
  patch?: (out: Record<string, unknown>) => void,
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = generated;
  void _schema;
  const out: Record<string, unknown> = {
    ...rest,
    type: "object",
    required,
    additionalProperties: false,
  };
  if (patch) patch(out);
  return out;
}

function objectProperties(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const props = schema.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    return props as Record<string, unknown>;
  }
  return undefined;
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "computer_pair",
    description:
      "Redeem a one-time pair code for a capability token bound to this Bot's computer/bird/flock. Account/MCP auth does not authorize pairing. If this Bot has no computer yet, call with an optional plan (personal, pro, or team) to get a checkout link. With per-bot keys, call with no arguments to get a pair code and approve_url, then call again with that pair_code. If bot_label is not your name, stop and call computer_pair. Keep pair_code and capability_token in your own bot memory.",
    inputSchema: advertisedSchema(ComputerPairArgsSchema, []),
  },
  {
    name: "computer_status",
    description:
      "Return computer lifecycle state. Requires a valid capability with status scope. If bot_label is not your name, stop and call computer_pair.",
    inputSchema: advertisedSchema(ComputerStatusArgsSchema, []),
  },
  {
    name: "computer_exec",
    description:
      "Run argv[] on the computer. Default mode is argv. mode=shell requires the shell scope (not granted by default pairing). Pipelines use argv [\"bash\",\"-lc\",\"...\"]. If bot_label is not your name, stop and call computer_pair.",
    inputSchema: advertisedSchema(
      ComputerExecArgsSchema,
      ["argv"],
      (schema) => {
        const props = objectProperties(schema);
        const env = props?.env;
        if (env && typeof env === "object" && !Array.isArray(env)) {
          (env as Record<string, unknown>).maxProperties = MCP_MAX_ENV_KEYS;
        }
      },
    ),
  },
  {
    name: "computer_fs",
    description:
      "Filesystem operation inside the workspace jail (stat/list/read/write/mkdir/move/copy/delete). Path escape is rejected. If bot_label is not your name, stop and call computer_pair.",
    inputSchema: advertisedSchema(ComputerFsArgsSchema, ["operation", "path"]),
  },
  {
    name: "computer_observe",
    description:
      "Observe the computer display. Set include_screenshot true to see the screen as an image. Set include_accessibility true for AX node ids (required before click_element). Accessibility is never fabricated as live CDP. Screenshot is screen_width by screen_height pixels (coordinate_space screen_pixels); your client may show it scaled. screen_blank true means the screenshot is a single colour, including a white about:blank window. If bot_label is not your name, stop and call computer_pair.",
    inputSchema: advertisedSchema(ComputerObserveArgsSchema, []),
  },
  {
    name: "computer_act",
    description:
      "Apply a bounded action batch. For clicks: computer_observe({ include_accessibility: true }) then click_element with an AX node id from that tree (15s). Guessed/offscreen clicks fail closed. click_coordinates use full-size screen pixels from computer_observe. Prefer click_element. open_url reports NAVIGATION_FAILED if the page didn't load. Also type/key/scroll/wait. No public VNC/takeover. If bot_label is not your name, stop and call computer_pair.",
    inputSchema: advertisedSchema(ComputerActArgsSchema, ["actions"]),
  },
  {
    name: "handoff_send",
    description:
      "Send an explicit file handoff to another Node. Not available yet. Returns NOT AVAILABLE; no files are sent or received.",
    inputSchema: advertisedSchema(HandoffArgsSchema, []),
  },
  {
    name: "handoff_receive",
    description:
      "Receive an explicit file handoff. Not available yet. Returns NOT AVAILABLE; no files are sent or received.",
    inputSchema: advertisedSchema(HandoffArgsSchema, []),
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
