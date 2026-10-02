import { randomBytes } from "node:crypto";
import type { McpLogger } from "../../src/lib/mcp/log";

/** One id per process boot. Safe to log. */
export const MCP_INSTANCE_ID = randomBytes(4).toString("hex");

/** JSON logs for Preview and local runs. Production stays quiet. */
export function vercelMcpLogger(env: NodeJS.ProcessEnv = process.env): McpLogger {
  if (env.VERCEL_ENV === "production") {
    return { info() {}, warn() {}, error() {} };
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
