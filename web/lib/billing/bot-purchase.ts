import { MCP_PREFERRED_PROTOCOL, MCP_SUPPORTED_PROTOCOLS } from "../../../src/lib/mcp/config";
import { jsonRpcResult } from "../../../src/lib/mcp/protocol";
import { getComputerService } from "../desks/runtime";
import { getOauthStore, type OauthAccess } from "../oauth";
import { activeComputerIdsForFlock } from "./pending-binds";
import {
  NO_COMPUTER_MESSAGE,
  checkoutPlanCards,
  createBuyLink,
  parseCheckoutPlan,
} from "./buy-link";

export const NO_COMPUTER_TOOL_MESSAGE = "No computer yet. Call computer_pair to get one.";
export const RECONNECT_COMPUTER_MESSAGE =
  "Reconnect Staxions in Grok and pick a computer on the Allow screen.";

const COMPUTER_TOOLS = new Set([
  "computer_pair",
  "computer_status",
  "computer_exec",
  "computer_fs",
  "computer_observe",
  "computer_act",
]);

type ToolCall = {
  id: string | number;
  name: string;
  args: Record<string, unknown>;
};

function toolCall(body: unknown): ToolCall | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as { method?: unknown; id?: unknown; params?: unknown };
  if (rec.method !== "tools/call") return null;
  if (typeof rec.id !== "string" && typeof rec.id !== "number") return null;
  const params = rec.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const name = (params as { name?: unknown }).name;
  if (typeof name !== "string" || !COMPUTER_TOOLS.has(name)) return null;
  const args = (params as { arguments?: unknown }).arguments;
  return {
    id: rec.id,
    name,
    args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
  };
}

function envelope(isError: boolean, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
    structuredContent: payload,
  };
}

function rpc(id: string | number, protocol: string, isError: boolean, payload: Record<string, unknown>) {
  return jsonRpcResult(id, envelope(isError, payload), protocol);
}

export function protocolForPurchase(presented: string | undefined): string {
  if (presented && MCP_SUPPORTED_PROTOCOLS.includes(presented)) return presented;
  return MCP_PREFERRED_PROTOCOL;
}

export async function purchaseToolResult(
  body: unknown,
  access: OauthAccess,
  origin: string,
  protocolVersion: string,
): Promise<Record<string, unknown> | null> {
  const call = toolCall(body);
  if (!call) return null;
  if (access.computerId) return boundTool(call, access, protocolVersion);
  const owned = await activeComputerIdsForFlock(access.flock);
  if (owned.length > 0) {
    return rpc(call.id, protocolVersion, true, { message: RECONNECT_COMPUTER_MESSAGE });
  }
  if (call.name !== "computer_pair" && call.name !== "computer_status") {
    return rpc(call.id, protocolVersion, true, { message: NO_COMPUTER_TOOL_MESSAGE });
  }
  const plan = call.name === "computer_pair" ? (call.args.plan === undefined ? "personal" : parseCheckoutPlan(call.args.plan)) : "personal";
  if (!plan) {
    return rpc(call.id, protocolVersion, true, { message: "plan must be personal, pro, or team." });
  }
  if (!access.email) {
    return rpc(call.id, protocolVersion, true, { message: RECONNECT_COMPUTER_MESSAGE });
  }
  try {
    const link = await createBuyLink({
      origin,
      email: access.email,
      subject: access.subject,
      flock: access.flock,
      clientId: access.clientId,
      plan,
    });
    return rpc(call.id, protocolVersion, false, {
      connected: false,
      needs_purchase: true,
      checkout_url: link.url,
      plans: checkoutPlanCards(),
      message: NO_COMPUTER_MESSAGE,
    });
  } catch (err) {
    console.error("[bot.checkout]", err instanceof Error ? err.message : "checkout link failed");
    return rpc(call.id, protocolVersion, true, { message: "Checkout is not configured." });
  }
}

async function boundTool(
  call: ToolCall,
  access: OauthAccess,
  protocolVersion: string,
): Promise<Record<string, unknown> | null> {
  if (call.name !== "computer_pair" && call.name !== "computer_status") return null;
  const computerId = access.computerId;
  if (!computerId) return null;
  const service = await getComputerService();
  let computer;
  try {
    computer = await service.get(computerId);
  } catch {
    return rpc(call.id, protocolVersion, true, { message: RECONNECT_COMPUTER_MESSAGE });
  }
  if (computer.flockId !== access.flock) {
    return rpc(call.id, protocolVersion, true, { message: RECONNECT_COMPUTER_MESSAGE });
  }
  if (call.name === "computer_status") {
    return rpc(call.id, protocolVersion, false, {
      connected: true,
      computer_handle: computer.id,
      state: computer.state,
    });
  }
  const issued = await service.issueBoundCapability(computer.id, access.flock);
  await getOauthStore().bindLiveTokens({
    clientId: access.clientId,
    subject: access.subject,
    computerId: computer.id,
    capabilityId: issued.capabilityId,
  });
  return rpc(call.id, protocolVersion, false, {
    connected: true,
    computer_handle: issued.computerHandle,
    capability_token: issued.token,
    capability_id: issued.capabilityId,
    flock_id: issued.flockId,
    scopes: issued.scopes,
    expires_at: issued.expiresAt.toISOString(),
  });
}
