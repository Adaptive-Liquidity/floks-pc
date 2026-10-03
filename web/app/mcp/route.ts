import { NextResponse } from "next/server";
import type { ComputerService } from "../../../src/lib/computers/index";
import { McpGateway } from "../../../src/lib/mcp/handler";
import { mcpNegotiatedProtocol } from "../../../src/lib/mcp/http";
import { publicOriginFromRequest } from "../../lib/auth/callback";
import { protocolForPurchase, purchaseToolResult } from "../../lib/billing/bot-purchase";
import { getComputerService } from "../../lib/desks/runtime";
import { requireWakeAdmission } from "../../lib/desks/wake-admission";
import { bindPairFlock } from "../../lib/mcp-flock";
import { MCP_INSTANCE_ID, vercelMcpLogger } from "../../lib/mcp-log";
import { accessClaims, getOauthStore, hashToken } from "../../lib/oauth";

export const runtime = "nodejs";
/** Must stay above FLOK_WAKE_CALL_BUDGET_MS so a wake can finish inside one request. */
export const maxDuration = 120;

let gateway: McpGateway | null = null;
let gatewayService: ComputerService | null = null;

async function sharedGateway(): Promise<McpGateway> {
  const service = await getComputerService();
  if (!gateway || gatewayService !== service) {
    gateway = new McpGateway(service, { logger: vercelMcpLogger(), instanceId: MCP_INSTANCE_ID });
    gatewayService = service;
  }
  return gateway;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function rpcId(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return "id" in body ? body.id : null;
}

export async function POST(request: Request): Promise<Response> {
  const origin = publicOriginFromRequest(request);
  const token = bearer(request);
  const claims = token ? await accessClaims(token) : null;
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "bearer required" } },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer realm="staxions", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400 },
    );
  }
  if (!bindPairFlock(body, claims.flock)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId(body),
        error: { code: -32602, message: "flock does not match the signed-in account" },
      },
      { status: 200 },
    );
  }
  const protocol = request.headers.get("mcp-protocol-version") ?? undefined;
  logRequestShape(request, body);
  const perBotKeys = process.env.FLOK_PER_BOT_KEYS === "true";
  const access = token ? await getOauthStore().getAccess(hashToken(token)) : null;
  const bound =
    !perBotKeys && access && access.computerId && access.capabilityId
      ? { capabilityId: access.capabilityId, flockId: access.flock }
      : undefined;
  if (!perBotKeys && access && !access.revoked && access.expiresAt > Date.now() && !bound) {
    const purchased = await purchaseToolResult(body, access, origin, protocolForPurchase(protocol));
    if (purchased) {
      return NextResponse.json(purchased, {
        headers: { "Mcp-Protocol-Version": mcpNegotiatedProtocol(purchased, protocol) },
      });
    }
  }
  const method =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { method?: unknown }).method === "string"
      ? (body as { method: string }).method
      : "";
  if (method === "tools/call" && bound) {
    try {
      const service = await getComputerService();
      const cap = service.getCapability(bound.capabilityId);
      const decision = await requireWakeAdmission(cap.computerId);
      if (!decision.allow) {
        return NextResponse.json({ ok: false, reason: decision.reason }, { status: decision.status });
      }
    } catch {
      // Capability lookup failures stay on the existing JSON-RPC path.
    }
  }
  const result = await (await sharedGateway()).handleJsonRpc(body, {
    authorization: `Bearer oauth:${claims.subject}`,
    ...(protocol ? { protocolVersionHeader: protocol } : {}),
    ...(bound ? { bound } : {}),
    ...(perBotKeys
      ? { perBotKeys: true, account: { subject: claims.subject, flock: claims.flock, origin } }
      : {}),
  });
  if (result === null) return new Response(null, { status: 202 });
  return NextResponse.json(result, {
    headers: { "Mcp-Protocol-Version": mcpNegotiatedProtocol(result, protocol) },
  });
}

function logRequestShape(request: Request, body: unknown): void {
  if (process.env.VERCEL_ENV === "production") return;
  const names = [...request.headers.keys()].filter(
    (name) => !/authorization|cookie|token|code/i.test(name),
  );
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const params =
    record.params && typeof record.params === "object" && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};
  const meta =
    params._meta && typeof params._meta === "object" && !Array.isArray(params._meta)
      ? (params._meta as Record<string, unknown>)
      : record._meta && typeof record._meta === "object" && !Array.isArray(record._meta)
        ? (record._meta as Record<string, unknown>)
        : {};
  const clientInfo = clientInfoOf(params.clientInfo) ?? clientInfoOf(meta["io.modelcontextprotocol/clientInfo"]);
  console.info(
    JSON.stringify({
      event: "mcp.request_shape",
      headers: names,
      user_agent: (request.headers.get("user-agent") ?? "").slice(0, 120),
      mcp_protocol_version: request.headers.get("mcp-protocol-version"),
      mcp_method: request.headers.get("mcp-method"),
      mcp_name: request.headers.get("mcp-name"),
      has_mcp_session_id: request.headers.has("mcp-session-id"),
      meta_keys: Object.keys(meta),
      client_info: clientInfo,
      method: typeof record.method === "string" ? record.method : undefined,
    }),
  );
}

function clientInfoOf(value: unknown): { name?: string; version?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as { name?: unknown; version?: unknown };
  const info: { name?: string; version?: string } = {};
  if (typeof row.name === "string") info.name = row.name.slice(0, 80);
  if (typeof row.version === "string") info.version = row.version.slice(0, 40);
  return info;
}
