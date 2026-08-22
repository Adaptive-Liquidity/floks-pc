/**
 * MCP JSON-RPC protocol helpers.
 * Speaks 2026-07-28 (stateless Streamable HTTP) and a 2025-era initialize
 * compatibility path. Transport session IDs are never authorization.
 */

import {
  MCP_LEGACY_PROTOCOLS,
  MCP_PREFERRED_PROTOCOL,
  MCP_SERVER_INFO,
  MCP_SUPPORTED_PROTOCOLS,
} from "./config.js";
import {
  JSONRPC_HEADER_MISMATCH,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_UNSUPPORTED_PROTOCOL,
  McpProtocolError,
} from "./errors.js";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  /** Notifications must not carry a JSON-RPC id. */
  id?: never;
}

export function isJsonRpcNotification(
  value: JsonRpcRequest | JsonRpcNotification,
): value is JsonRpcNotification {
  return !("id" in value) || (value as { id?: unknown }).id === undefined;
}

export function parseJsonRpc(raw: unknown): JsonRpcRequest | JsonRpcNotification {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new McpProtocolError(JSONRPC_INVALID_REQUEST, "INVALID_REQUEST", "invalid JSON-RPC");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string" || obj.method.length === 0) {
    throw new McpProtocolError(JSONRPC_INVALID_REQUEST, "INVALID_REQUEST", "invalid JSON-RPC");
  }
  if (!("id" in obj) || obj.id === undefined) {
    const note: JsonRpcNotification = { jsonrpc: "2.0", method: obj.method };
    if ("params" in obj) note.params = obj.params;
    return note;
  }
  if (obj.id !== null && typeof obj.id !== "string" && typeof obj.id !== "number") {
    throw new McpProtocolError(JSONRPC_INVALID_REQUEST, "INVALID_REQUEST", "invalid JSON-RPC id");
  }
  if (obj.id === null) {
    throw new McpProtocolError(JSONRPC_INVALID_REQUEST, "INVALID_REQUEST", "invalid JSON-RPC id");
  }
  const req: JsonRpcRequest = { jsonrpc: "2.0", id: obj.id, method: obj.method };
  if ("params" in obj) req.params = obj.params;
  return req;
}

export function negotiateProtocol(
  presented: string | undefined,
  opts: { fallbackOnUnknown?: boolean } = {},
): string {
  if (presented === undefined || presented.length === 0) {
    return MCP_PREFERRED_PROTOCOL;
  }
  if (MCP_SUPPORTED_PROTOCOLS.includes(presented)) {
    return presented;
  }
  if (opts.fallbackOnUnknown === true) {
    return MCP_PREFERRED_PROTOCOL;
  }
  throw new McpProtocolError(
    JSONRPC_UNSUPPORTED_PROTOCOL,
    "UNSUPPORTED_PROTOCOL",
    `unsupported MCP protocol version: ${presented}`,
  );
}

export function isLegacyProtocol(version: string): boolean {
  return (MCP_LEGACY_PROTOCOLS as readonly string[]).includes(version);
}

export function assertHeaderAgreement(
  headerMethod: string | undefined,
  headerName: string | undefined,
  bodyMethod: string,
  toolName: string | undefined,
): void {
  if (headerMethod !== undefined && headerMethod.length > 0 && headerMethod !== bodyMethod) {
    throw new McpProtocolError(
      JSONRPC_HEADER_MISMATCH,
      "HEADER_MISMATCH",
      "Mcp-Method does not match JSON-RPC method",
    );
  }
  if (
    bodyMethod === "tools/call" &&
    headerName !== undefined &&
    headerName.length > 0 &&
    toolName !== undefined &&
    headerName !== toolName
  ) {
    throw new McpProtocolError(
      JSONRPC_HEADER_MISMATCH,
      "HEADER_MISMATCH",
      "Mcp-Name does not match tools/call name",
    );
  }
}

export function serverDiscoverResult(protocolVersion: string): Record<string, unknown> {
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { ...MCP_SERVER_INFO },
    instructions:
      "Pair with computer_pair using a one-time pair code. After pairing, pass capability_token and computer_handle on every computer_* tool. MCP/account auth never authorizes computer access.",
  };
}

export function initializeResult(protocolVersion: string): Record<string, unknown> {
  return serverDiscoverResult(protocolVersion);
}

export function jsonRpcResult(
  id: JsonRpcId,
  result: unknown,
  protocolVersion: string,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result,
    _meta: {
      "io.modelcontextprotocol/serverInfo": { ...MCP_SERVER_INFO },
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
    },
  };
}

export function header(headers: NodeJS.Dict<string | string[]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}
