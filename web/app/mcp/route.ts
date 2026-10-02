import { NextResponse } from "next/server";
import { McpGateway } from "../../../src/lib/mcp/handler";
import { publicOriginFromRequest } from "../../lib/auth/callback";
import { getComputerService } from "../../lib/desks/runtime";
import { bindPairFlock } from "../../lib/mcp-flock";
import { accessClaims } from "../../lib/oauth";

export const runtime = "nodejs";

let gateway: McpGateway | null = null;

async function sharedGateway(): Promise<McpGateway> {
  if (!gateway) gateway = new McpGateway(await getComputerService());
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

export async function POST(request: Request): Promise<NextResponse> {
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
  const body: unknown = await request.json();
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
  const result = await (await sharedGateway()).handleJsonRpc(body, {
    authorization: `Bearer oauth:${claims.subject}`,
    ...(protocol ? { protocolVersionHeader: protocol } : {}),
  });
  return NextResponse.json(result ?? { ok: true });
}
