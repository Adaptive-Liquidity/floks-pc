/**
 * MCP gateway: JSON-RPC methods → ComputerService only.
 * Capability tokens authorize computer access. MCP/session/account auth does not.
 */

import { capabilityAuth, sharedAccountAuth } from "../computers/capabilities.js";
import { CapabilityMissing, PairCodeInvalid } from "../computers/errors.js";
import type { ComputerService } from "../computers/service.js";
import type {
  Action,
  ComputerOperationAuth,
  ExecRequest,
  FsRequest,
  ObserveRequest,
} from "../computers/types.js";
import {
  MCP_MAX_ENV_KEYS,
  MCP_MAX_EXEC_OUTPUT_CHARS,
  MCP_MAX_JSONRPC_BATCH,
} from "./config.js";
import {
  JSONRPC_INTERNAL,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  jsonRpcError,
  McpProtocolError,
  publicErrorFromUnknown,
} from "./errors.js";
import { silentLogger, type McpLogger } from "./log.js";
import {
  assertHeaderAgreement,
  initializeResult,
  isJsonRpcNotification,
  isLegacyProtocol,
  jsonRpcResult,
  negotiateProtocol,
  parseJsonRpc,
  serverDiscoverResult,
  type JsonRpcId,
} from "./protocol.js";
import {
  connectionIdentityFromAuth,
  PairConnectionThrottle,
  type ConnectionIdentity,
} from "./throttle.js";
import {
  ComputerActArgsSchema,
  ComputerExecArgsSchema,
  ComputerFsArgsSchema,
  ComputerObserveArgsSchema,
  ComputerPairArgsSchema,
  ComputerStatusArgsSchema,
  HandoffArgsSchema,
  MCP_TOOL_NAMES,
  toolsListResult,
} from "./tools.js";

export interface McpRequestContext {
  authorization?: string;
  remoteAddress?: string;
  protocolVersionHeader?: string;
  mcpMethodHeader?: string;
  mcpNameHeader?: string;
  /** Present but never used as Bot identity or authorization. */
  mcpSessionId?: string;
}

export interface McpGatewayOptions {
  logger?: McpLogger;
}

interface ToolOk {
  isError: false;
  payload: Record<string, unknown>;
}

interface ToolErr {
  isError: true;
  payload: Record<string, unknown>;
}

type ToolOutcome = ToolOk | ToolErr;

export class McpGateway {
  private readonly logger: McpLogger;
  private readonly pairThrottle = new PairConnectionThrottle();

  constructor(
    private readonly service: ComputerService,
    opts: McpGatewayOptions = {},
  ) {
    this.logger = opts.logger ?? silentLogger;
  }

  /** Test helper. */
  resetThrottle(): void {
    this.pairThrottle.reset();
  }

  async handleJsonRpc(
    raw: unknown,
    ctx: McpRequestContext = {},
  ): Promise<Record<string, unknown> | Record<string, unknown>[] | null> {
    if (Array.isArray(raw)) {
      if (raw.length === 0) {
        return jsonRpcError(null, JSONRPC_INVALID_REQUEST, "empty batch", "INVALID_REQUEST");
      }
      if (raw.length > MCP_MAX_JSONRPC_BATCH) {
        return jsonRpcError(null, JSONRPC_INVALID_PARAMS, "batch too large", "INVALID_PARAMS");
      }
      const out: Record<string, unknown>[] = [];
      for (const item of raw) {
        const one = await this.handleSingle(item, ctx);
        if (one) out.push(one);
      }
      return out.length > 0 ? out : null;
    }
    return this.handleSingle(raw, ctx);
  }

  private async handleSingle(
    raw: unknown,
    ctx: McpRequestContext,
  ): Promise<Record<string, unknown> | null> {
    let parsed;
    try {
      parsed = parseJsonRpc(raw);
    } catch (err) {
      if (err instanceof McpProtocolError) {
        return jsonRpcError(null, err.rpcCode, err.message, err.publicCode);
      }
      return jsonRpcError(null, JSONRPC_INTERNAL, "invalid JSON-RPC", "INVALID_REQUEST");
    }

    const toolName =
      parsed.method === "tools/call" ? toolNameFromParams(parsed.params) : undefined;
    try {
      assertHeaderAgreement(ctx.mcpMethodHeader, ctx.mcpNameHeader, parsed.method, toolName);
    } catch (err) {
      if (err instanceof McpProtocolError) {
        const id = isJsonRpcNotification(parsed) ? null : parsed.id;
        return jsonRpcError(id, err.rpcCode, err.message, err.publicCode);
      }
      throw err;
    }

    if (isJsonRpcNotification(parsed)) {
      this.logger.info("mcp.notification", { method: parsed.method });
      return null;
    }

    try {
      return await this.dispatch(parsed.id, parsed.method, parsed.params, ctx);
    } catch (err) {
      if (err instanceof McpProtocolError) {
        return jsonRpcError(parsed.id, err.rpcCode, err.message, err.publicCode);
      }
      this.logger.error("mcp.dispatch_failed", { method: parsed.method });
      return jsonRpcError(parsed.id, JSONRPC_INTERNAL, "internal error", "INTERNAL");
    }
  }

  private async dispatch(
    id: JsonRpcId,
    method: string,
    params: unknown,
    ctx: McpRequestContext,
  ): Promise<Record<string, unknown>> {
    const presented = protocolVersionFrom(params) ?? ctx.protocolVersionHeader;
    const protocolVersion =
      method === "initialize"
        ? negotiateProtocol(presented, { fallbackOnUnknown: true })
        : negotiateProtocol(presented);

    switch (method) {
      case "initialize":
        this.logger.info("mcp.initialize", { protocolVersion });
        return jsonRpcResult(id, initializeResult(protocolVersion), protocolVersion);
      case "ping":
        return jsonRpcResult(id, {}, protocolVersion);
      case "server/discover":
        return jsonRpcResult(id, serverDiscoverResult(protocolVersion), protocolVersion);
      case "tools/list":
        return jsonRpcResult(id, toolsListResult(), protocolVersion);
      case "tools/call":
        return jsonRpcResult(id, await this.toolsCall(params, ctx, protocolVersion), protocolVersion);
      default:
        if (isLegacyProtocol(protocolVersion) && method.startsWith("notifications/")) {
          return jsonRpcResult(id, {}, protocolVersion);
        }
        throw new McpProtocolError(
          JSONRPC_METHOD_NOT_FOUND,
          "METHOD_NOT_FOUND",
          `method not found: ${method}`,
        );
    }
  }

  private async toolsCall(
    params: unknown,
    ctx: McpRequestContext,
    protocolVersion: string,
  ): Promise<Record<string, unknown>> {
    void protocolVersion;
    const name = toolNameFromParams(params);
    const args = argsFromParams(params);
    this.logger.info("mcp.tools_call", { name });
    if (!name || !isKnownTool(name)) {
      return toolEnvelope(true, { code: "UNKNOWN_TOOL", message: "unknown tool" });
    }
    const outcome = await this.invokeTool(name, args, ctx);
    return toolEnvelope(outcome.isError, outcome.payload);
  }

  private async invokeTool(
    name: (typeof MCP_TOOL_NAMES)[number],
    args: unknown,
    ctx: McpRequestContext,
  ): Promise<ToolOutcome> {
    try {
      switch (name) {
        case "computer_pair":
          return await this.computerPair(args, ctx);
        case "computer_status":
          return await this.computerStatus(args);
        case "computer_exec":
          return await this.computerExec(args);
        case "computer_fs":
          return await this.computerFs(args);
        case "computer_observe":
          return await this.computerObserve(args);
        case "computer_act":
          return await this.computerAct(args);
        case "handoff_send":
        case "handoff_receive": {
          const parsed = HandoffArgsSchema.parse(args ?? {});
          requireToken(parsed.capability_token);
          return {
            isError: true,
            payload: {
              code: "PHASE_NOT_STARTED",
              phase: "C9",
              message:
                "Handoffs are not implemented. Explicit Node file sharing is Gate C9. Browser profiles, cookies, keys, .env, and capability tokens are never transferred.",
            },
          };
        }
        default: {
          const _never: never = name;
          void _never;
          return { isError: true, payload: { code: "UNKNOWN_TOOL", message: "unknown tool" } };
        }
      }
    } catch (err) {
      return this.toolFailure(err);
    }
  }

  private async computerPair(args: unknown, ctx: McpRequestContext): Promise<ToolOutcome> {
    const parsed = ComputerPairArgsSchema.parse(args ?? {});
    const identity = { birdId: parsed.bird_id, flockId: parsed.flock_id };
    const conn = this.connectionIdentity(ctx);
    try {
      this.pairThrottle.assert(conn);
    } catch {
      this.logger.warn("mcp.pair_throttled", { connection: conn.authenticated ? "auth" : "unauth" });
      return {
        isError: true,
        payload: { code: "PAIR_THROTTLED", message: "too many pair attempts" },
      };
    }

    const shared = parsed.account_id ? sharedAccountAuth(parsed.account_id) : undefined;
    try {
      const paired = await this.service.pair(parsed.pair_code, identity, shared);
      this.logger.info("mcp.pair_ok", {
        capability_id: paired.capabilityId,
        computer_handle: paired.computerHandle,
        node_handle: paired.nodeHandle,
      });
      return {
        isError: false,
        payload: {
          capability_token: paired.token,
          capability_id: paired.capabilityId,
          computer_handle: paired.computerHandle,
          node_handle: paired.nodeHandle,
          flock_id: paired.flockId,
          scopes: [...paired.scopes],
          expires_at: paired.expiresAt.toISOString(),
        },
      };
    } catch (err) {
      this.pairThrottle.noteFailure(conn);
      if (err instanceof PairCodeInvalid) {
        this.logger.warn("mcp.pair_denied", { reason: String(err.details?.reason ?? "invalid") });
      }
      return this.toolFailure(err);
    }
  }

  private async computerStatus(args: unknown): Promise<ToolOutcome> {
    const parsed = ComputerStatusArgsSchema.parse(args ?? {});
    const status = await this.service.status(
      cap(requireToken(parsed.capability_token)),
      parsed.computer_handle,
    );
    const payload: Record<string, unknown> = { state: status.state };
    if (status.lastActiveAt) payload.last_active_at = status.lastActiveAt.toISOString();
    return { isError: false, payload };
  }

  private async computerExec(args: unknown): Promise<ToolOutcome> {
    const parsed = ComputerExecArgsSchema.parse(args ?? {});
    if (parsed.env && Object.keys(parsed.env).length > MCP_MAX_ENV_KEYS) {
      return {
        isError: true,
        payload: { code: "INVALID_PARAMS", message: "env exceeds limit" },
      };
    }
    const request: ExecRequest = { argv: [...parsed.argv] };
    if (parsed.cwd !== undefined) request.cwd = parsed.cwd;
    if (parsed.env !== undefined) request.env = parsed.env;
    if (parsed.timeout_ms !== undefined) request.timeoutMs = parsed.timeout_ms;
    if (parsed.mode !== undefined) request.mode = parsed.mode;
    const result = await this.service.exec(
      cap(requireToken(parsed.capability_token)),
      parsed.computer_handle,
      request,
    );
    const stdout = clip(result.stdout);
    const stderr = clip(result.stderr);
    return {
      isError: false,
      payload: {
        exit_code: result.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        timed_out: result.timedOut,
      },
    };
  }

  private async computerFs(args: unknown): Promise<ToolOutcome> {
    const parsed = ComputerFsArgsSchema.parse(args ?? {});
    const request: FsRequest = {
      operation: parsed.operation,
      path: parsed.path,
    };
    if (parsed.content !== undefined) request.content = parsed.content;
    if (parsed.destination !== undefined) request.destination = parsed.destination;
    if (parsed.encoding !== undefined) request.encoding = parsed.encoding;
    const result = await this.service.filesystem(
      cap(requireToken(parsed.capability_token)),
      parsed.computer_handle,
      request,
    );
    if (!result.ok) {
      return {
        isError: true,
        payload: {
          code: result.errorCode ?? "FS_FAILED",
          message: result.errorCode === "PATH_ESCAPE" ? "path escapes workspace jail" : "filesystem operation failed",
        },
      };
    }
    const payload: Record<string, unknown> = { ok: true };
    if (result.data !== undefined) payload.data = result.data;
    return { isError: false, payload };
  }

  private async computerObserve(args: unknown): Promise<ToolOutcome> {
    const parsed = ComputerObserveArgsSchema.parse(args ?? {});
    const request: ObserveRequest = {};
    if (parsed.include_screenshot === true) request.includeScreenshot = true;
    if (parsed.include_accessibility === true) request.includeAccessibility = true;
    const observation = await this.service.observe(
      cap(requireToken(parsed.capability_token)),
      parsed.computer_handle,
      request,
    );
    const payload: Record<string, unknown> = {
      screen_width: observation.screenWidth,
      screen_height: observation.screenHeight,
    };
    if (observation.activeWindow !== undefined) {
      payload.active_window = observation.activeWindow;
    }
    if (parsed.include_screenshot === true && observation.screenshotBase64) {
      payload.screenshot_base64 = observation.screenshotBase64;
    }
    if (parsed.include_accessibility === true && observation.accessibilitySummary !== undefined) {
      payload.accessibility_summary = observation.accessibilitySummary;
    }
    return { isError: false, payload };
  }

  private async computerAct(args: unknown): Promise<ToolOutcome> {
    const parsed = ComputerActArgsSchema.parse(args ?? {});
    const result = await this.service.act(
      cap(requireToken(parsed.capability_token)),
      parsed.computer_handle,
      { actions: parsed.actions.map(toAction) },
    );
    return {
      isError: false,
      payload: {
        ok: result.ok,
        results: result.results.map((r) => {
          const row: Record<string, unknown> = {
            type: r.action.type,
            success: r.success,
          };
          if (r.error !== undefined) row.error = r.error;
          return row;
        }),
      },
    };
  }

  private toolFailure(err: unknown): ToolErr {
    const pub = publicErrorFromUnknown(err);
    if (pub.code === "INTERNAL") {
      this.logger.error("mcp.tool_internal", {});
    }
    return { isError: true, payload: { code: pub.code, message: pub.message } };
  }

  private connectionIdentity(ctx: McpRequestContext): ConnectionIdentity {
    return connectionIdentityFromAuth(ctx.authorization, ctx.remoteAddress);
  }
}

function cap(token: string): ComputerOperationAuth {
  return capabilityAuth(token);
}

function requireToken(token: string | undefined): string {
  if (!token || token.length === 0) {
    throw new CapabilityMissing("missing capability");
  }
  return token;
}

function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= MCP_MAX_EXEC_OUTPUT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MCP_MAX_EXEC_OUTPUT_CHARS), truncated: true };
}

function toAction(item: {
  type: Action["type"];
  elementId?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  text?: string | undefined;
  key?: string | undefined;
  url?: string | undefined;
  application?: string | undefined;
  durationMs?: number | undefined;
}): Action {
  const action: Action = { type: item.type };
  if (item.elementId !== undefined) action.elementId = item.elementId;
  if (item.x !== undefined) action.x = item.x;
  if (item.y !== undefined) action.y = item.y;
  if (item.text !== undefined) action.text = item.text;
  if (item.key !== undefined) action.key = item.key;
  if (item.url !== undefined) action.url = item.url;
  if (item.application !== undefined) action.application = item.application;
  if (item.durationMs !== undefined) action.durationMs = item.durationMs;
  return action;
}

function toolEnvelope(isError: boolean, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
    structuredContent: payload,
  };
}

function toolNameFromParams(params: unknown): string | undefined {
  if (params && typeof params === "object" && !Array.isArray(params) && "name" in params) {
    const name = (params as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function argsFromParams(params: unknown): unknown {
  if (params && typeof params === "object" && !Array.isArray(params) && "arguments" in params) {
    return (params as { arguments?: unknown }).arguments ?? {};
  }
  return {};
}

function protocolVersionFrom(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const rec = params as Record<string, unknown>;
  if (typeof rec.protocolVersion === "string") return rec.protocolVersion;
  const meta = rec._meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const v = (meta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function isKnownTool(name: string): name is (typeof MCP_TOOL_NAMES)[number] {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name);
}
