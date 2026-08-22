/**
 * Streamable HTTP transport for POST /mcp.
 * Stateless. Session headers are ignored for identity. Optional wrapper auth
 * authenticates the connection only.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { digestEquals, sha256Hex } from "../computers/digest.js";
import { MCP_MAX_BODY_BYTES, MCP_PATH, type McpGatewayConfig } from "./config.js";
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

export async function handleMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpHttpOptions,
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
  } catch {
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

  const ctx: McpRequestContext = {};
  if (authorization) ctx.authorization = authorization;
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
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("mcp-protocol-version", protocol ?? "2026-07-28");
  res.end(JSON.stringify(result));
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
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        req.resume();
        finish(() => reject(new Error("too large")));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (err: Error) => finish(() => reject(err)));
  });
}
