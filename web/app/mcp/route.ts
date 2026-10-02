import { NextResponse } from "next/server";
import type { ComputerService } from "../../../src/lib/computers/index";
import { McpGateway } from "../../../src/lib/mcp/handler";
import { mcpNegotiatedProtocol } from "../../../src/lib/mcp/http";
import { publicOriginFromRequest } from "../../lib/auth/callback";
import { protocolForPurchase, purchaseToolResult } from "../../lib/billing/bot-purchase";
import { getComputerService } from "../../lib/desks/runtime";
import { bindPairFlock } from "../../lib/mcp-flock";
import { accessClaims, getOauthStore, hashToken } from "../../lib/oauth";

export const runtime = "nodejs";

let gateway: McpGateway | null = null;
let gatewayService: ComputerService | null = null;

async function sharedGateway(): Promise<McpGateway> {
  const service = await getComputerService();
  if (!gateway || gatewayService !== service) {
    gateway = new McpGateway(service);
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
  const access = token ? await getOauthStore().getAccess(hashToken(token)) : null;
  if (access && !access.revoked && access.expiresAt > Date.now()) {
    const purchased = await purchaseToolResult(body, access, origin, protocolForPurchase(protocol));
    if (purchased) {
      return NextResponse.json(purchased, {
        headers: { "Mcp-Protocol-Version": mcpNegotiatedProtocol(purchased, protocol) },
      });
    }
  }
  const result = await (await sharedGateway()).handleJsonRpc(body, {
    authorization: `Bearer oauth:${claims.subject}`,
    ...(protocol ? { protocolVersionHeader: protocol } : {}),
  });
  if (result === null) return new Response(null, { status: 202 });
  return NextResponse.json(result, {
    headers: { "Mcp-Protocol-Version": mcpNegotiatedProtocol(result, protocol) },
  });
}
