/**
 * Streamable HTTP transport for POST /mcp.
 * Stateless. Session headers are ignored for identity. Optional wrapper auth
 * authenticates the connection only.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { digestEquals, sha256Hex } from "../computers/digest.js";
import {
  MCP_MAX_BODY_BYTES,
  MCP_PATH,
  MCP_PREFERRED_PROTOCOL,
  MCP_SUPPORTED_PROTOCOLS,
  type McpGatewayConfig,
} from "./config.js";
import { JSONRPC_INTERNAL, jsonRpcError } from "./errors.js";
import { McpGateway, type McpRequestContext } from "./handler.js";
import { header } from "./protocol.js";
import { parseBearer } from "./throttle.js";
import type { McpLogger } from "./log.js";

export interface McpHttpOptions {
  gateway: McpGateway;
  config?: McpGatewayConfig;
  logger?: McpLogger;
  path?: string;
}

/** Always-ending internal error. Never includes stacks, secrets, or provider refs. */
export function endUnhandledMcpError(
  res: ServerResponse,
  id: string | number | null = null,
): void {
  if (res.writableEnded) return;
  try {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
    }
    res.end(JSON.stringify(jsonRpcError(id, JSONRPC_INTERNAL, "internal error", "INTERNAL")));
  } catch {
    try {
      res.end();
    } catch {
      /* already closed */
    }
  }
}

export async function handleMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpHttpOptions,
): Promise<void> {
  let rpcId: string | number | null = null;
  let notification = false;
  try {
    await handleMcpHttpInner(req, res, opts, {
      noteId: (id) => {
        rpcId = id;
      },
      noteNotification: () => {
        notification = true;
      },
    });
  } catch {
    try {
      opts.logger?.error("mcp.http_internal", {});
    } catch {
      /* never let logging block the sanitized 500 */
    }
    if (notification) {
      if (!res.writableEnded) {
        try {
          res.statusCode = 202;
          res.end();
        } catch {
          /* client already gone */
        }
      }
      return;
    }
    endUnhandledMcpError(res, rpcId);
  }
}

async function handleMcpHttpInner(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpHttpOptions,
  notes: {
    noteId: (id: string | number) => void;
    noteNotification: () => void;
  },
): Promise<void> {
  const path = opts.path ?? MCP_PATH;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== path) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }));
    return;
  }

  if (req.method === "GET" || req.method === "DELETE" || req.method === "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "POST");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Flok MCP Gateway is Streamable HTTP POST /mcp (stateless 2026-07-28).",
        },
      }),
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("allow", "POST");
    res.end();
    return;
  }

  const config = opts.config ?? {};
  const authorization = header(req.headers, "authorization");
  if (config.authToken) {
    const presented = parseBearer(authorization);
    if (!presented || !digestEquals(sha256Hex(presented), sha256Hex(config.authToken))) {
      opts.logger?.warn("mcp.http_unauthorized", {});
      res.statusCode = 401;
      res.setHeader("www-authenticate", 'Bearer realm="flok-mcp"');
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "invalid MCP wrapper auth" } }));
      return;
    }
  }

  let body: string;
  try {
    body = await readBody(req, MCP_MAX_BODY_BYTES);
  } catch (err) {
    if (isAbortError(err)) {
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* client already gone */
        }
      }
      return;
    }
    res.statusCode = 413;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "body too large" } }));
    return;
  }

  let parsed: unknown;
  try {
    parsed = body.length === 0 ? {} : JSON.parse(body);
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error" },
      }),
    );
    return;
  }

  const parsedId = jsonRpcIdOf(parsed);
  if (parsedId !== undefined) notes.noteId(parsedId);
  else if (isJsonRpcNotificationShape(parsed)) notes.noteNotification();

  const ctx: McpRequestContext = {};
  // Only use bearer-keyed identity when wrapper auth is configured and the
  // bearer was already validated above. Forwarding an unvalidated caller-
  // supplied bearer as an authenticated identity would let attackers saturate
  // the throttle map with arbitrary tokens when auth is disabled.
  if (config.authToken && authorization) ctx.authorization = authorization;
  if (req.socket.remoteAddress) ctx.remoteAddress = req.socket.remoteAddress;
  const protocol = header(req.headers, "mcp-protocol-version");
  if (protocol) ctx.protocolVersionHeader = protocol;
  const mcpMethod = header(req.headers, "mcp-method");
  if (mcpMethod) ctx.mcpMethodHeader = mcpMethod;
  const mcpName = header(req.headers, "mcp-name");
  if (mcpName) ctx.mcpNameHeader = mcpName;
  const session = header(req.headers, "mcp-session-id");
  if (session) ctx.mcpSessionId = session;

  const result = await opts.gateway.handleJsonRpc(parsed, ctx);
  if (result === null) {
    res.statusCode = 202;
    res.end();
    return;
  }
  const negotiated =
    protocolFromRpc(result) ?? supportedRequestProtocol(protocol) ?? MCP_PREFERRED_PROTOCOL;

  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("mcp-protocol-version", negotiated);
  res.end(JSON.stringify(result));
}

function supportedRequestProtocol(presented: string | undefined): string | undefined {
  if (!presented) return undefined;
  return MCP_SUPPORTED_PROTOCOLS.includes(presented) ? presented : undefined;
}

function jsonRpcIdOf(parsed: unknown): string | number | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const id = (parsed as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") return id;
  return undefined;
}

function isJsonRpcNotificationShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return !("id" in parsed) || (parsed as { id?: unknown }).id === undefined;
}

function protocolFromRpc(
  result: Record<string, unknown> | Record<string, unknown>[],
): string | undefined {
  const recs = Array.isArray(result) ? result : [result];
  for (const rec of recs) {
    if (!rec || typeof rec !== "object") continue;
    const meta = rec._meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
    const version = (meta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"];
    if (typeof version === "string" && version.length > 0) return version;
  }
  return undefined;
}

const BODY_TOO_LARGE = "PAYLOAD_TOO_LARGE";
const BODY_ABORTED = "ABORTED";

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === BODY_ABORTED);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    const abort = (): void =>
      finish(() => reject(Object.assign(new Error("aborted"), { code: BODY_ABORTED })));
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        req.resume();
        finish(() => reject(Object.assign(new Error("too large"), { code: BODY_TOO_LARGE })));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (err: Error) => finish(() => reject(err)));
    req.on("aborted", abort);
    req.on("close", () => {
      if (!req.complete) abort();
    });
  });
}
