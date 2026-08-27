/**
 * L2 operator HTTP: Live Node Console + JSON API.
 * Control-plane only. Not MCP. Not a Bot capability surface.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { ComputerError } from "../computers/errors.js";
import type { ComputerService } from "../computers/service.js";
import type { McpGatewayConfig } from "../mcp/config.js";
import { MCP_MAX_BODY_BYTES, MCP_PATH } from "../mcp/config.js";
import { handleMcpHttp, type McpHttpOptions } from "../mcp/http.js";
import { header } from "../mcp/protocol.js";
import { isLoopbackHostname } from "../mcp/remote.js";
import { operatorConsoleHtml } from "./console-html.js";
import {
  OPERATOR_API_PREFIX,
  OPERATOR_CONSOLE_PATH,
  OPERATOR_MCP_TOOL_COUNT,
} from "./view.js";

export interface OperatorHttpOptions {
  service: ComputerService;
  config?: McpGatewayConfig;
}

const DestroyBodySchema = z.object({
  confirm: z.literal(true),
  providerRef: z.string().trim().min(1).max(256),
});

const ComputerIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{16,64}$/i);

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/** Operator console is loopback-only. Forwarded clients are not local operators. */
export function isOperatorLoopbackPeer(req: IncomingMessage): boolean {
  if (header(req.headers, "x-forwarded-for")) return false;
  if (header(req.headers, "x-real-ip")) return false;
  if (header(req.headers, "cf-connecting-ip")) return false;
  if (header(req.headers, "forwarded")) return false;
  const addr = req.socket.remoteAddress ?? "";
  return isLoopbackHostname(addr);
}

function isJsonContentType(req: IncomingMessage): boolean {
  const raw = header(req.headers, "content-type") ?? "";
  return /^application\/json(\s*;|$)/i.test(raw);
}

export function isLocalOperatorOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

function assertBetaMutationRequest(req: IncomingMessage): void {
  if (!isJsonContentType(req)) {
    throw new ComputerError(
      "OPERATOR_JSON_REQUIRED",
      "beta roster mutations require Content-Type application/json",
    );
  }
  const origin = header(req.headers, "origin");
  if (!isLocalOperatorOrigin(origin)) {
    throw new ComputerError(
      "OPERATOR_ORIGIN_FORBIDDEN",
      "beta roster mutations reject non-local Origin",
    );
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MCP_MAX_BODY_BYTES) {
      throw new ComputerError("OPERATOR_BODY_TOO_LARGE", "request body too large");
    }
    chunks.push(buf);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function mapComputerError(err: ComputerError): { status: number; code: string; message: string } {
  if (err.code === "COMPUTER_NOT_FOUND") {
    return { status: 404, code: err.code, message: "computer not found" };
  }
  if (err.code === "DESTROY_CONFIRM_REQUIRED" || err.code === "DESTROY_PROVIDER_REF_MISMATCH") {
    return { status: 409, code: err.code, message: err.message };
  }
  if (err.code === "QUOTA_EXCEEDED") {
    return { status: 409, code: err.code, message: err.message };
  }
  if (err.code === "BETA_INVITE_REQUIRED") {
    return { status: 403, code: err.code, message: err.message };
  }
  if (err.code === "BETA_STORE_REQUIRED") {
    return { status: 503, code: err.code, message: err.message };
  }
  if (err.code === "OPERATOR_JSON_REQUIRED") {
    return { status: 415, code: err.code, message: err.message };
  }
  if (err.code === "OPERATOR_ORIGIN_FORBIDDEN") {
    return { status: 403, code: err.code, message: err.message };
  }
  return { status: 400, code: err.code, message: "operator request refused" };
}

function computerIdFrom(pathname: string, suffix: string): string | null {
  const prefix = `${OPERATOR_API_PREFIX}/computers/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (suffix === "") {
    return ComputerIdSchema.safeParse(rest).success ? rest : null;
  }
  if (!rest.endsWith(suffix)) return null;
  const id = rest.slice(0, rest.length - suffix.length);
  return ComputerIdSchema.safeParse(id).success ? id : null;
}

export async function handleOperatorHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OperatorHttpOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  void opts.config;

  if (!isOperatorLoopbackPeer(req)) {
    json(res, 403, errorBody("OPERATOR_LOOPBACK_ONLY", "operator console is loopback-only"));
    return;
  }

  if ((pathname === "/" || req.url === "/") && (req.method === "GET" || req.method === "HEAD")) {
    res.statusCode = 302;
    res.setHeader("location", OPERATOR_CONSOLE_PATH);
    res.end();
    return;
  }

  if (pathname === OPERATOR_CONSOLE_PATH && (req.method === "GET" || req.method === "HEAD")) {
    const html = operatorConsoleHtml();
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(html);
    return;
  }

  try {
    if (pathname === `${OPERATOR_API_PREFIX}/snapshot` && req.method === "GET") {
      await opts.service.sweepIdle();
      const snap = opts.service.operatorSnapshot();
      json(res, 200, { ...snap, mcpToolCount: OPERATOR_MCP_TOOL_COUNT });
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/limitations` && req.method === "GET") {
      json(res, 200, {
        limitations: opts.service.debugPacket().limitations,
        costWarning: opts.service.operatorSnapshot().beta.costWarning,
      });
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/debug-packet` && req.method === "GET") {
      await opts.service.sweepIdle();
      const packet = opts.service.debugPacket();
      const blob = JSON.stringify(packet);
      if (blob.includes("screenshotBase64") || blob.includes("tokenDigest") || /"providerRef"/.test(blob)) {
        json(res, 500, errorBody("INTERNAL", "internal error"));
        return;
      }
      json(res, 200, { packet });
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/beta` && req.method === "GET") {
      json(res, 200, { beta: opts.service.operatorSnapshot().beta });
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/beta/waitlist` && req.method === "POST") {
      assertBetaMutationRequest(req);
      const body = z.object({ ownerId: z.string().trim().min(1).max(128) }).parse(await readJsonBody(req));
      const roster = await opts.service.waitlistBetaOwner(body.ownerId);
      json(res, 200, roster);
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/beta/approve` && req.method === "POST") {
      assertBetaMutationRequest(req);
      const body = z.object({ ownerId: z.string().trim().min(1).max(128) }).parse(await readJsonBody(req));
      const roster = await opts.service.approveBetaOwner(body.ownerId);
      json(res, 200, roster);
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/computers` && req.method === "GET") {
      json(res, 200, { computers: opts.service.operatorSnapshot().computers });
      return;
    }
    if (pathname === `${OPERATOR_API_PREFIX}/events` && req.method === "GET") {
      json(res, 200, { events: opts.service.listOperatorEvents() });
      return;
    }
    const detailId = computerIdFrom(pathname, "");
    if (detailId && req.method === "GET") {
      const view = opts.service.operatorSnapshot().computers.find((c) => c.id === detailId);
      if (!view) {
        json(res, 404, errorBody("COMPUTER_NOT_FOUND", "computer not found"));
        return;
      }
      json(res, 200, { computer: view });
      return;
    }
    const observeId = computerIdFrom(pathname, "/observe");
    if (observeId && req.method === "POST") {
      await readJsonBody(req);
      const observation = await opts.service.operatorObserve(observeId, {
        includeAccessibility: true,
        includeScreenshot: true,
      });
      json(res, 200, { observation });
      return;
    }
    const destroyId = computerIdFrom(pathname, "/destroy");
    if (destroyId && req.method === "POST") {
      const parsed = DestroyBodySchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        json(
          res,
          409,
          errorBody(
            "DESTROY_CONFIRM_REQUIRED",
            "Refusing to destroy: confirm must be true and providerRef must match the selected computer",
          ),
        );
        return;
      }
      const computer = await opts.service.destroyThisComputer(destroyId, parsed.data);
      json(res, 200, {
        computer: {
          id: computer.id,
          state: computer.state,
          birdId: computer.birdId,
        },
      });
      return;
    }
  } catch (err) {
    if (err instanceof ComputerError) {
      const mapped = mapComputerError(err);
      json(res, mapped.status, errorBody(mapped.code, mapped.message));
      return;
    }
    if (err instanceof SyntaxError || err instanceof z.ZodError) {
      json(res, 400, errorBody("OPERATOR_JSON_INVALID", "invalid json"));
      return;
    }
    json(res, 500, errorBody("INTERNAL", "internal error"));
    return;
  }

  json(res, 404, errorBody("NOT_FOUND", "not found"));
}

export async function dispatchRuntimeHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OperatorHttpOptions & McpHttpOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const operator =
    pathname === "/" ||
    pathname === OPERATOR_CONSOLE_PATH ||
    pathname === OPERATOR_API_PREFIX ||
    pathname.startsWith(`${OPERATOR_API_PREFIX}/`);
  if (operator) {
    await handleOperatorHttp(req, res, opts);
    return;
  }
  await handleMcpHttp(req, res, { ...opts, path: opts.path ?? MCP_PATH });
}
