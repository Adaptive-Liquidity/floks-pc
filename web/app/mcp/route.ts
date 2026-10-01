import { NextResponse } from "next/server";
import { McpGateway } from "../../../src/lib/mcp/handler";
import { MCP_TOOL_NAMES } from "../../../src/lib/mcp/tools";
import { getComputerService } from "../../lib/desks/runtime";
import { accessSubject } from "../../lib/oauth";
import { publicOriginFromRequest } from "../../lib/auth/callback";

export const runtime = "nodejs";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = publicOriginFromRequest(request);
  const token = bearer(request);
  const subject = token ? await accessSubject(token) : null;
  if (!subject) {
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
  const body = (await request.json()) as { method?: string; params?: { name?: string; arguments?: { flock_id?: string } } };
  if (body.method === "tools/call" && body.params?.arguments?.flock_id && body.params.arguments.flock_id !== subject) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32602, message: "flock does not match the token subject" } },
      { status: 200 },
    );
  }
  const gateway = new McpGateway(await getComputerService());
  const protocol = request.headers.get("mcp-protocol-version") ?? undefined;
  const result = await gateway.handleJsonRpc(body, {
    ...(protocol ? { protocolVersionHeader: protocol } : {}),
  });
  return NextResponse.json(result ?? { ok: true });
}

export function toolNames(): readonly string[] {
  return MCP_TOOL_NAMES;
}
