/**
 * Public MCP gateway surface. Routes and tests import this, never a provider.
 */

export {
  MCP_LEGACY_PROTOCOLS,
  MCP_MAX_BODY_BYTES,
  MCP_MAX_ENV_KEYS,
  MCP_MAX_EXEC_OUTPUT_CHARS,
  MCP_MAX_JSONRPC_BATCH,
  MCP_PAIR_CONNECTION_FAILURE_LIMIT,
  MCP_PATH,
  MCP_PREFERRED_PROTOCOL,
  MCP_SERVER_INFO,
  MCP_SUPPORTED_PROTOCOLS,
  loadMcpGatewayConfig,
  mcpComputersEnabled,
} from "./config.js";
export type { McpGatewayConfig } from "./config.js";

export { McpGateway } from "./handler.js";
export type { McpGatewayOptions, McpRequestContext } from "./handler.js";

export { handleMcpHttp } from "./http.js";
export type { McpHttpOptions } from "./http.js";

export { MCP_TOOL_NAMES, MCP_TOOLS, toolsListResult } from "./tools.js";
export type { McpToolDefinition, McpToolName } from "./tools.js";

export { silentLogger } from "./log.js";
export type { McpLogger } from "./log.js";

export {
  PairConnectionThrottle,
  connectionIdentityFromAuth,
  parseBearer,
} from "./throttle.js";
