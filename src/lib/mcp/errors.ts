/**
 * Public MCP / JSON-RPC errors. Never include token digests, provider refs,
 * stacks, or raw secrets.
 */

import { ComputerError } from "../computers/errors.js";

export const JSONRPC_PARSE = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL = -32603;
export const JSONRPC_HEADER_MISMATCH = -32020;
export const JSONRPC_UNSUPPORTED_PROTOCOL = -32022;
export const JSONRPC_APPLICATION = -32000;

export interface PublicError {
  code: string;
  message: string;
}

export class McpProtocolError extends Error {
  readonly rpcCode: number;
  readonly publicCode: string;

  constructor(rpcCode: number, publicCode: string, message: string) {
    super(message);
    this.name = "McpProtocolError";
    this.rpcCode = rpcCode;
    this.publicCode = publicCode;
  }
}

export function publicErrorFromUnknown(err: unknown): PublicError {
  if (err instanceof McpProtocolError) {
    return { code: err.publicCode, message: err.message };
  }
  if (err instanceof ComputerError) {
    return { code: err.code, message: sanitizeMessage(err.message) };
  }
  if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
    return { code: "INVALID_PARAMS", message: "invalid tool arguments" };
  }
  return { code: "INTERNAL", message: "internal error" };
}

function sanitizeMessage(message: string): string {
  // Drop anything that looks like a digest or bearer.
  return message.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}

export function jsonRpcError(
  id: string | number | null,
  rpcCode: number,
  message: string,
  publicCode?: string,
): Record<string, unknown> {
  const error: Record<string, unknown> = {
    code: rpcCode,
    message,
  };
  if (publicCode) {
    error.data = { code: publicCode };
  }
  return {
    jsonrpc: "2.0",
    id,
    error,
  };
}
