/**
 * MCP gateway configuration. Secrets come from the process environment of the
 * control plane — never from ~/flok/token, never from a Node VM, never from
 * client-supplied account_id.
 */

export const MCP_PREFERRED_PROTOCOL = "2026-07-28";
export const MCP_LEGACY_PROTOCOLS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const MCP_SUPPORTED_PROTOCOLS: readonly string[] = [
  MCP_PREFERRED_PROTOCOL,
  ...MCP_LEGACY_PROTOCOLS,
];

export const MCP_SERVER_INFO = {
  name: "flok-mcp-gateway",
  version: "0.0.1",
} as const;

export const MCP_PATH = "/mcp";
export const MCP_MAX_BODY_BYTES = 1_048_576;
export const MCP_MAX_EXEC_OUTPUT_CHARS = 64_000;
export const MCP_MAX_ARGV = 64;
export const MCP_MAX_ARG_CHARS = 8_192;
export const MCP_MAX_ENV_KEYS = 32;

/** Per authenticated (or unauthenticated) MCP connection, not per Bot identity. */
export const MCP_PAIR_CONNECTION_FAILURE_LIMIT = 20;
export const MCP_PAIR_CONNECTION_WINDOW_MS = 10 * 60 * 1000;

export interface McpGatewayConfig {
  /** Optional public base URL (documentation / Grok connector). */
  baseUrl?: string;
  /**
   * Optional wrapper Bearer token for the HTTP endpoint.
   * This authenticates the *connection*, not a Bot, and never authorizes
   * computer access. Distinct from Flok publish tokens and capability secrets.
   */
  authToken?: string;
  listenHost?: string;
  listenPort?: number;
}

export function loadMcpGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): McpGatewayConfig {
  const config: McpGatewayConfig = {};
  const baseUrl = env.FLOK_MCP_BASE_URL?.trim();
  if (baseUrl) config.baseUrl = baseUrl;
  const authToken = env.FLOK_MCP_AUTH_TOKEN?.trim();
  if (authToken) config.authToken = authToken;
  const listenHost = env.FLOK_MCP_LISTEN_HOST?.trim();
  if (listenHost) config.listenHost = listenHost;
  const portRaw = env.FLOK_MCP_LISTEN_PORT?.trim();
  if (portRaw) {
    const port = Number.parseInt(portRaw, 10);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      config.listenPort = port;
    }
  }
  return config;
}

export function mcpComputersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.FLOK_MCP_COMPUTERS_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
