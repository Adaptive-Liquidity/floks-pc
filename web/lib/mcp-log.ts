import { randomBytes } from "node:crypto";
import type { McpLogger } from "../../src/lib/mcp/log";
import { mcpAuditRow, postgresMcpAuditSink, type McpAuditSink } from "./mcp-audit";

/** One id per process boot. Safe to log. */
export const MCP_INSTANCE_ID = randomBytes(4).toString("hex");

/**
 * Preview and local runs write JSON to the console.
 * Production writes one metadata row. It does not write command output.
 */
export function vercelMcpLogger(
  env: NodeJS.ProcessEnv = process.env,
  sink: McpAuditSink = postgresMcpAuditSink(env),
): McpLogger {
  if (env.VERCEL_ENV === "production") {
    const write = (level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => {
      void sink(mcpAuditRow(level, event, fields));
    };
    return {
      info: (event, fields) => write("info", event, fields),
      warn: (event, fields) => write("warn", event, fields),
      error: (event, fields) => write("error", event, fields),
    };
  }
  const write = (level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ event, ...(fields ?? {}) });
    if (level === "warn") console.warn(line);
    else if (level === "error") console.error(line);
    else console.info(line);
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
