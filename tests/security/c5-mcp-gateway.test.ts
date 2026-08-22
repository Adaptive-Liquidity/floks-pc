/**
 * C5 gate: public MCP gateway.
 * MCP / account-level auth cannot identify a Bot and cannot access a computer.
 * Tools call ComputerService only. FakeProvider. Zero paid Runloop.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import {
  ComputerService,
  FLAGS,
  FakeProvider,
  MemoryRunloopControlPlane,
  RunloopProvider,
  assertNexusDisabled,
} from "../../src/lib/computers/index.js";
import {
  MCP_MAX_BODY_BYTES,
  MCP_MAX_EXEC_OUTPUT_CHARS,
  MCP_MAX_JSONRPC_BATCH,
  MCP_PAIR_CONNECTION_FAILURE_LIMIT,
  MCP_PATH,
  MCP_PREFERRED_PROTOCOL,
  MCP_TOOL_NAMES,
  McpGateway,
  handleMcpHttp,
  loadMcpGatewayConfig,
  parseBearer,
  PairConnectionThrottle,
} from "../../src/lib/mcp/index.js";
import { RecordingLogger, blobContainsSecret } from "../../src/lib/mcp/log.js";

const FLOCK = "flock-adaptive";
const SECRET_PATH = "/home/flok/workspace/secret.txt";

describe("C5 MCP gateway", () => {
  let provider: FakeProvider;
  let service: ComputerService;
  let logger: RecordingLogger;
  let gateway: McpGateway;

  beforeEach(() => {
    provider = new FakeProvider();
    service = new ComputerService(provider);
    logger = new RecordingLogger();
    gateway = new McpGateway(service, { logger });
  });

  async function provision(birdId: string) {
    const computer = await service.requestComputer({ birdId, flockId: FLOCK });
    const issued = await service.issuePairCode(computer.id);
    return { computer, issued };
  }

  async function rpc(
    method: string,
    params?: unknown,
    ctx?: { authorization?: string; remoteAddress?: string; mcpMethodHeader?: string; mcpNameHeader?: string },
  ) {
    const req: Record<string, unknown> = { jsonrpc: "2.0", id: 1, method };
    if (params !== undefined) req.params = params;
    const res = await gateway.handleJsonRpc(req, ctx ?? {});
    assert.ok(res && !Array.isArray(res));
    return res as Record<string, unknown>;
  }

  function payload(res: Record<string, unknown>): Record<string, unknown> {
    const result = res.result as Record<string, unknown>;
    assert.ok(result && typeof result === "object");
    return result.structuredContent as Record<string, unknown>;
  }

  async function pairThroughMcp(birdId: string) {
    const { computer, issued } = await provision(birdId);
    const res = await rpc("tools/call", {
      name: "computer_pair",
      arguments: { pair_code: issued.code, bird_id: birdId, flock_id: FLOCK },
    });
    const body = payload(res);
    assert.equal((res.result as { isError: boolean }).isError, false);
    return {
      computer,
      issued,
      token: String(body.capability_token),
      handle: String(body.computer_handle),
      capabilityId: String(body.capability_id),
    };
  }

  it("tool list exposes exactly the 8 allowed tools", async () => {
    const res = await rpc("tools/list");
    const result = res.result as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
    const names = result.tools.map((t) => t.name);
    assert.deepEqual(names, [...MCP_TOOL_NAMES]);
    assert.equal(names.length, 8);
    const exec = result.tools.find((t) => t.name === "computer_exec");
    assert.ok(exec);
    const execSchema = exec.inputSchema;
    const required = execSchema.required as string[];
    assert.equal(required.includes("capability_token"), true);
    const props = execSchema.properties as Record<string, Record<string, unknown>>;
    assert.equal(props.argv.maxItems, 64);
    const env = props.env as Record<string, unknown>;
    assert.equal(env.maxProperties, 32);
    const fs = result.tools.find((t) => t.name === "computer_fs");
    assert.ok(fs);
    const fsProps = (fs.inputSchema.properties as Record<string, Record<string, unknown>>);
    assert.equal(fsProps.path.maxLength, 2048);
  });

  it("computer_pair redeems a valid pair code and returns a capability once", async () => {
    const { computer, issued } = await provision("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_pair",
      arguments: {
        pair_code: issued.code,
        bird_id: "bird-noema",
        flock_id: FLOCK,
        account_id: "xai-team-shared-mcp",
      },
    });
    const body = payload(res);
    assert.equal((res.result as { isError: boolean }).isError, false);
    assert.equal(typeof body.capability_token, "string");
    assert.ok(String(body.capability_token).length > 20);
    assert.equal(body.computer_handle, computer.id);
    assert.equal(body.node_handle, "bird-noema");
    assert.ok(Array.isArray(body.scopes));
    assert.equal((body.scopes as string[]).includes("shell"), false);

    const reuse = await rpc("tools/call", {
      name: "computer_pair",
      arguments: { pair_code: issued.code, bird_id: "bird-noema", flock_id: FLOCK },
    });
    assert.equal((reuse.result as { isError: boolean }).isError, true);
    assert.equal(payload(reuse).code, "PAIR_CODE_INVALID");
  });

  it("computer_pair rejects expired/reused/mismatched pair code", async () => {
    const expiredComp = await service.requestComputer({ birdId: "bird-exp", flockId: FLOCK });
    const expired = await service.issuePairCode(expiredComp.id, { ttlMs: -1000 });
    const expiredRes = await rpc("tools/call", {
      name: "computer_pair",
      arguments: { pair_code: expired.code, bird_id: "bird-exp", flock_id: FLOCK },
    });
    assert.equal(payload(expiredRes).code, "PAIR_CODE_INVALID");

    const { issued } = await provision("bird-mis");
    const mismatch = await rpc("tools/call", {
      name: "computer_pair",
      arguments: { pair_code: issued.code, bird_id: "bird-other", flock_id: FLOCK },
    });
    assert.equal(payload(mismatch).code, "PAIR_CODE_INVALID");
  });

  it("computer_status succeeds with correct cap", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_status",
      arguments: { capability_token: noema.token, computer_handle: noema.handle },
    });
    assert.equal((res.result as { isError: boolean }).isError, false);
    assert.equal(payload(res).state, "ready");
    assert.equal("providerDetail" in payload(res), false);
    assert.equal("provider_ref" in payload(res), false);
  });

  it("computer_status fails with missing/shared-only/wrong/expired/revoked cap", async () => {
    const noema = await pairThroughMcp("bird-noema");

    const missing = await rpc("tools/call", {
      name: "computer_status",
      arguments: { computer_handle: noema.handle },
    });
    assert.equal(payload(missing).code, "CAPABILITY_MISSING");

    const sharedOnly = await rpc("tools/call", {
      name: "computer_status",
      arguments: {
        computer_handle: noema.handle,
        account_id: "xai-team-shared-mcp",
      },
    });
    assert.equal(payload(sharedOnly).code, "CAPABILITY_MISSING");

    const wrong = await rpc("tools/call", {
      name: "computer_status",
      arguments: { capability_token: "not-the-issued-token", computer_handle: noema.handle },
    });
    assert.equal(payload(wrong).code, "CAPABILITY_INVALID");

    const expiredComp = await service.requestComputer({ birdId: "bird-exp2", flockId: FLOCK });
    const expiredIssued = await service.issuePairCode(expiredComp.id, { capabilityTtlMs: -1000 });
    const expiredPair = await rpc("tools/call", {
      name: "computer_pair",
      arguments: { pair_code: expiredIssued.code, bird_id: "bird-exp2", flock_id: FLOCK },
    });
    const expiredTok = String(payload(expiredPair).capability_token);
    const expiredStatus = await rpc("tools/call", {
      name: "computer_status",
      arguments: { capability_token: expiredTok, computer_handle: expiredComp.id },
    });
    assert.equal(payload(expiredStatus).code, "CAPABILITY_EXPIRED");

    await service.revokeCapability(noema.capabilityId);
    const revoked = await rpc("tools/call", {
      name: "computer_status",
      arguments: { capability_token: noema.token, computer_handle: noema.handle },
    });
    assert.equal(payload(revoked).code, "CAPABILITY_REVOKED");
  });

  it("computer_exec succeeds with correct cap and exec scope", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_exec",
      arguments: {
        capability_token: noema.token,
        computer_handle: noema.handle,
        argv: ["uname", "-s"],
      },
    });
    assert.equal((res.result as { isError: boolean }).isError, false);
    assert.equal(payload(res).exit_code, 0);
    assert.equal(String(payload(res).stdout).includes("uname"), true);
  });

  it("computer_exec shell mode fails without shell scope", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_exec",
      arguments: {
        capability_token: noema.token,
        computer_handle: noema.handle,
        argv: ["echo", "hi"],
        mode: "shell",
      },
    });
    assert.equal(payload(res).code, "INSUFFICIENT_SCOPE");
  });

  it("computer_fs write then read succeeds with correct cap", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const write = await rpc("tools/call", {
      name: "computer_fs",
      arguments: {
        capability_token: noema.token,
        computer_handle: noema.handle,
        operation: "write",
        path: SECRET_PATH,
        content: "noema-private",
      },
    });
    assert.equal((write.result as { isError: boolean }).isError, false);
    const read = await rpc("tools/call", {
      name: "computer_fs",
      arguments: {
        capability_token: noema.token,
        computer_handle: noema.handle,
        operation: "read",
        path: SECRET_PATH,
      },
    });
    assert.equal(payload(read).data, "noema-private");
  });

  it("computer_fs path escape fails", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_fs",
      arguments: {
        capability_token: noema.token,
        computer_handle: noema.handle,
        operation: "read",
        path: "/etc/passwd",
      },
    });
    assert.equal((res.result as { isError: boolean }).isError, true);
    assert.equal(payload(res).code, "PATH_ESCAPE");
  });

  it("NOEMA cap cannot access Code computer through MCP tools", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const code = await pairThroughMcp("bird-code");
    await rpc("tools/call", {
      name: "computer_fs",
      arguments: {
        capability_token: code.token,
        computer_handle: code.handle,
        operation: "write",
        path: SECRET_PATH,
        content: "code-only",
      },
    });
    const stolen = await rpc("tools/call", {
      name: "computer_fs",
      arguments: {
        capability_token: noema.token,
        computer_handle: code.handle,
        operation: "read",
        path: SECRET_PATH,
      },
    });
    assert.equal(payload(stolen).code, "CROSS_NODE_DENIED");
    const status = await rpc("tools/call", {
      name: "computer_status",
      arguments: { capability_token: noema.token, computer_handle: code.handle },
    });
    assert.equal(payload(status).code, "CROSS_NODE_DENIED");
  });

  it("Code cap cannot access NOEMA computer through MCP tools", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const code = await pairThroughMcp("bird-code");
    const stolen = await rpc("tools/call", {
      name: "computer_exec",
      arguments: {
        capability_token: code.token,
        computer_handle: noema.handle,
        argv: ["id"],
      },
    });
    assert.equal(payload(stolen).code, "CROSS_NODE_DENIED");
  });

  it("provider direct access is not reachable through the gateway", async () => {
    const listed = await rpc("tools/list");
    const blob = JSON.stringify(listed);
    assert.equal(blob.includes("RunloopProvider"), false);
    assert.equal(blob.includes("FakeProvider"), false);
    const unknown = await rpc("tools/call", {
      name: "provider_exec",
      arguments: { argv: ["true"] },
    });
    assert.equal(payload(unknown).code, "UNKNOWN_TOOL");
  });

  it("raw pair code and raw capability token are not logged", async () => {
    const { issued } = await provision("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_pair",
      arguments: { pair_code: issued.code, bird_id: "bird-noema", flock_id: FLOCK },
    });
    const token = String(payload(res).capability_token);
    const blob = logger.blob();
    assert.equal(blobContainsSecret(blob, issued.code), false);
    assert.equal(blobContainsSecret(blob, token), false);
    assert.equal(blob.includes("[redacted]") || !blob.includes("capability_token"), true);
  });

  it("computer_act applies bounded actions without leaking typed text or VNC", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_act",
      arguments: {
        capability_token: noema.token,
        computer_handle: noema.handle,
        actions: [
          { type: "type", text: "secret-typed-text" },
          { type: "click_coordinates", x: 12, y: 34 },
        ],
      },
    });
    assert.equal((res.result as { isError: boolean }).isError, false);
    assert.equal(payload(res).ok, true);
    const blob = JSON.stringify(payload(res));
    assert.equal(blob.includes("secret-typed-text"), false);
    const listed = await rpc("tools/list");
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    assert.equal(names.includes("computer_takeover"), false);
    assert.equal(names.includes("computer_vnc"), false);
  });

  it("handoff_send / handoff_receive fail closed if C9 is not implemented", async () => {
    const noema = await pairThroughMcp("bird-noema");
    for (const name of ["handoff_send", "handoff_receive"] as const) {
      const res = await rpc("tools/call", {
        name,
        arguments: { capability_token: noema.token, computer_handle: noema.handle },
      });
      assert.equal((res.result as { isError: boolean }).isError, true);
      assert.equal(payload(res).code, "PHASE_NOT_STARTED");
      assert.equal(payload(res).phase, "C9");
    }
  });

  it("observe does not fabricate accessibility", async () => {
    const noema = await pairThroughMcp("bird-noema");
    const res = await rpc("tools/call", {
      name: "computer_observe",
      arguments: { capability_token: noema.token, computer_handle: noema.handle },
    });
    const body = payload(res);
    assert.equal("accessibility_summary" in body, false);
    assert.equal("screenshot_base64" in body, false);
    assert.equal(typeof body.screen_width, "number");
  });

  it("initialize and server/discover work; session id is not identity", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const initResult = init.result as { protocolVersion: string; capabilities: { tools: unknown } };
    assert.equal(initResult.protocolVersion, "2025-06-18");
    assert.ok(initResult.capabilities.tools);

    const initUnknown = await rpc("initialize", {
      protocolVersion: "2099-01-01",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const unknownResult = initUnknown.result as { protocolVersion: string };
    assert.equal(unknownResult.protocolVersion, MCP_PREFERRED_PROTOCOL);

    const listedUnknown = await rpc("tools/list", {
      _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" },
    });
    assert.equal((listedUnknown.error as { code: number }).code, -32022);

    const discover = await rpc("server/discover", {
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    });
    const disc = discover.result as { protocolVersion: string };
    assert.equal(disc.protocolVersion, "2026-07-28");

    const noema = await pairThroughMcp("bird-noema");
    const withSession = await gateway.handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "computer_status",
          arguments: { capability_token: noema.token, computer_handle: noema.handle },
        },
      },
      { mcpSessionId: "forged-session-as-other-bot" },
    );
    assert.ok(withSession && !Array.isArray(withSession));
    assert.equal(((withSession as { result: { isError: boolean } }).result).isError, false);
  });

  it("Mcp-Method / Mcp-Name disagreement is rejected", async () => {
    const res = await rpc(
      "tools/list",
      {},
      { mcpMethodHeader: "tools/call" },
    );
    const err = res.error as { code: number };
    assert.equal(err.code, -32020);
  });

  it("POST /mcp HTTP round-trip pairs and stats; GET is 405", async () => {
    const { issued } = await provision("bird-http");
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      const get = await fetch(base);
      assert.equal(get.status, 405);

      const listed = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(listed.status, 200);
      const listedJson = (await listed.json()) as { result: { tools: unknown[] } };
      assert.equal(listedJson.result.tools.length, 8);

      const pair = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "computer_pair",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "computer_pair",
            arguments: { pair_code: issued.code, bird_id: "bird-http", flock_id: FLOCK },
          },
        }),
      });
      const pairJson = (await pair.json()) as {
        result: { isError: boolean; structuredContent: { capability_token: string; computer_handle: string } };
      };
      assert.equal(pairJson.result.isError, false);
      const st = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "computer_status",
            arguments: {
              capability_token: pairJson.result.structuredContent.capability_token,
              computer_handle: pairJson.result.structuredContent.computer_handle,
            },
          },
        }),
      });
      const stJson = (await st.json()) as { result: { isError: boolean; structuredContent: { state: string } } };
      assert.equal(stJson.result.structuredContent.state, "ready");

      const oversized = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(MCP_MAX_BODY_BYTES + 1),
      });
      assert.equal(oversized.status, 413);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("wrapper auth is connection auth only and is required when configured", async () => {
    const locked = new McpGateway(service, {
      logger,
    });
    const { issued } = await provision("bird-wrap");
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, {
        gateway: locked,
        config: { authToken: "wrapper-secret" },
        path: MCP_PATH,
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      const denied = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(denied.status, 401);

      const raw = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "wrapper-secret",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(raw.status, 401);

      const basic = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Basic wrapper-secret",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(basic.status, 401);

      const ok = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrapper-secret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "computer_pair",
            arguments: { pair_code: issued.code, bird_id: "bird-wrap", flock_id: FLOCK },
          },
        }),
      });
      const json = (await ok.json()) as { result: { isError: boolean } };
      assert.equal(ok.status, 200);
      assert.equal(json.result.isError, false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("connection throttle limits pair guesses without DoSing a second connection", async () => {
    const a = { remoteAddress: "10.0.0.1" };
    for (let i = 0; i < MCP_PAIR_CONNECTION_FAILURE_LIMIT; i += 1) {
      const res = await rpc(
        "tools/call",
        {
          name: "computer_pair",
          arguments: { pair_code: `NOPE-${i}`, bird_id: `bird-rot-${i}`, flock_id: FLOCK },
        },
        a,
      );
      assert.equal(payload(res).code, "PAIR_CODE_INVALID");
    }
    const blocked = await rpc(
      "tools/call",
      {
        name: "computer_pair",
        arguments: { pair_code: "NOPE-BLOCK", bird_id: "bird-rot-x", flock_id: FLOCK },
      },
      a,
    );
    assert.equal(payload(blocked).code, "PAIR_THROTTLED");

    const { issued } = await provision("bird-other-conn");
    const other = await rpc(
      "tools/call",
      {
        name: "computer_pair",
        arguments: { pair_code: issued.code, bird_id: "bird-other-conn", flock_id: FLOCK },
      },
      { remoteAddress: "10.0.0.2" },
    );
    assert.equal((other.result as { isError: boolean }).isError, false);
  });

  it("unvalidated Bearer values do not mint distinct pair-throttle identities", async () => {
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      for (let i = 0; i < MCP_PAIR_CONNECTION_FAILURE_LIMIT; i += 1) {
        const res = await fetch(base, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer rot-${i}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: {
              name: "computer_pair",
              arguments: { pair_code: `NOPE-${i}`, bird_id: `bird-rot-http-${i}`, flock_id: FLOCK },
            },
          }),
        });
        const json = (await res.json()) as { result: { structuredContent: { code: string } } };
        assert.equal(json.result.structuredContent.code, "PAIR_CODE_INVALID");
      }
      const blocked = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer rot-fresh",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "tools/call",
          params: {
            name: "computer_pair",
            arguments: { pair_code: "NOPE-FRESH", bird_id: "bird-rot-http-x", flock_id: FLOCK },
          },
        }),
      });
      const blockedJson = (await blocked.json()) as { result: { structuredContent: { code: string } } };
      assert.equal(blockedJson.result.structuredContent.code, "PAIR_THROTTLED");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("parseBearer accepts only the Bearer scheme", () => {
    assert.equal(parseBearer(undefined), undefined);
    assert.equal(parseBearer("wrapper-secret"), undefined);
    assert.equal(parseBearer("Basic abc"), undefined);
    assert.equal(parseBearer("Bearer tok"), "tok");
  });

  it("rejects invalid FLOK_MCP_LISTEN_PORT instead of silently defaulting", () => {
    assert.throws(() => loadMcpGatewayConfig({ FLOK_MCP_LISTEN_PORT: "abc" }));
    assert.throws(() => loadMcpGatewayConfig({ FLOK_MCP_LISTEN_PORT: "0" }));
    assert.throws(() => loadMcpGatewayConfig({ FLOK_MCP_LISTEN_PORT: "70000" }));
    assert.equal(loadMcpGatewayConfig({ FLOK_MCP_LISTEN_PORT: "8787" }).listenPort, 8787);
  });

  it("rejects oversized JSON-RPC batches", async () => {
    const batch = Array.from({ length: MCP_MAX_JSONRPC_BATCH + 1 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "ping",
    }));
    const res = await gateway.handleJsonRpc(batch);
    assert.ok(res && !Array.isArray(res));
    assert.equal((res as { error: { code: number } }).error.code, -32602);
  });

  it("computer_exec reports stdout truncation", async () => {
    class HugeExecProvider extends FakeProvider {
      override async exec(): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
        return {
          exitCode: 0,
          stdout: "A".repeat(MCP_MAX_EXEC_OUTPUT_CHARS + 8),
          stderr: "ok",
          timedOut: false,
        };
      }
    }
    const hugeService = new ComputerService(new HugeExecProvider());
    const hugeGateway = new McpGateway(hugeService, { logger });
    const computer = await hugeService.requestComputer({ birdId: "bird-clip", flockId: FLOCK });
    const issued = await hugeService.issuePairCode(computer.id);
    const pairRes = await hugeGateway.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "computer_pair",
        arguments: { pair_code: issued.code, bird_id: "bird-clip", flock_id: FLOCK },
      },
    });
    assert.ok(pairRes && !Array.isArray(pairRes));
    const pairBody = (pairRes as { result: { structuredContent: { capability_token: string; computer_handle: string } } })
      .result.structuredContent;
    const execRes = await hugeGateway.handleJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "computer_exec",
        arguments: {
          capability_token: pairBody.capability_token,
          computer_handle: pairBody.computer_handle,
          argv: ["true"],
        },
      },
    });
    assert.ok(execRes && !Array.isArray(execRes));
    const execBody = (execRes as {
      result: { structuredContent: { stdout: string; stdout_truncated: boolean; stderr_truncated: boolean } };
    }).result.structuredContent;
    assert.equal(execBody.stdout.length, MCP_MAX_EXEC_OUTPUT_CHARS);
    assert.equal(execBody.stdout_truncated, true);
    assert.equal(execBody.stderr_truncated, false);
  });

  it("unexpected gateway throw ends the HTTP response with a sanitized JSON-RPC 500", async () => {
    class BoomGateway extends McpGateway {
      override async handleJsonRpc(): Promise<null> {
        throw new Error(
          "RUNLOOP_API_KEY=rlk_live_abcdefghijklmnopqrstuvwxyz0123 pair_code=ABCD-EFGH-JK capability_token=tok_" +
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx stack at FakeProvider",
        );
      }
    }
    const boom = new BoomGateway(service, { logger });
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway: boom, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/list" }),
      });
      assert.equal(res.status, 500);
      const text = await res.text();
      const json = JSON.parse(text) as {
        jsonrpc: string;
        id: number;
        error: { code: number; message: string; data?: { code: string } };
      };
      assert.equal(json.jsonrpc, "2.0");
      assert.equal(json.id, 42);
      assert.equal(json.error.code, -32603);
      assert.equal(json.error.message, "internal error");
      assert.equal(json.error.data?.code, "INTERNAL");
      assert.equal(text.includes("RUNLOOP_API_KEY"), false);
      assert.equal(text.includes("rlk_live_"), false);
      assert.equal(text.includes("ABCD-EFGH-JK"), false);
      assert.equal(text.includes("capability_token"), false);
      assert.equal(text.includes("FakeProvider"), false);
      assert.equal(text.includes("stack"), false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("unexpected throw on a JSON-RPC notification does not emit a JSON-RPC response", async () => {
    class BoomGateway extends McpGateway {
      override async handleJsonRpc(): Promise<null> {
        throw new Error("notification boom");
      }
    }
    const boom = new BoomGateway(service, { logger });
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway: boom, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      assert.equal(res.status, 202);
      const text = await res.text();
      assert.equal(text.length, 0);
      assert.equal(text.includes("jsonrpc"), false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("initialize with unsupported protocol reports the negotiated version in body and response header", async () => {
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2099-01-01",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2099-01-01",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("mcp-protocol-version"), MCP_PREFERRED_PROTOCOL);
      const json = (await res.json()) as {
        result: { protocolVersion: string };
        _meta: { "io.modelcontextprotocol/protocolVersion": string };
      };
      assert.equal(json.result.protocolVersion, MCP_PREFERRED_PROTOCOL);
      assert.equal(json._meta["io.modelcontextprotocol/protocolVersion"], MCP_PREFERRED_PROTOCOL);

      const listed = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2099-01-01",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } },
        }),
      });
      const listedJson = (await listed.json()) as { error?: { code: number } };
      assert.equal(listed.status, 200);
      assert.equal(listed.headers.get("mcp-protocol-version"), MCP_PREFERRED_PROTOCOL);
      assert.equal(listedJson.error?.code, -32022);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("legacy protocol errors and mixed batches keep the supported request version in the header", async () => {
    const legacy = "2025-11-25";
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
    try {
      const unknown = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": legacy,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nope" }),
      });
      assert.equal(unknown.status, 200);
      assert.equal(unknown.headers.get("mcp-protocol-version"), legacy);
      const unknownJson = (await unknown.json()) as { error?: { code: number } };
      assert.equal(unknownJson.error?.code, -32601);

      const mixed = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": legacy,
        },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1 },
          { jsonrpc: "2.0", id: 2, method: "ping" },
        ]),
      });
      assert.equal(mixed.status, 200);
      assert.equal(mixed.headers.get("mcp-protocol-version"), legacy);
      const mixedJson = (await mixed.json()) as Array<{
        id?: number;
        error?: unknown;
        _meta?: { "io.modelcontextprotocol/protocolVersion"?: string };
      }>;
      assert.equal(Array.isArray(mixedJson), true);
      const ping = mixedJson.find((item) => item.id === 2);
      assert.equal(ping?._meta?.["io.modelcontextprotocol/protocolVersion"], legacy);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("client abort while uploading does not hang the HTTP handler", async () => {
    let handled: Promise<void> | undefined;
    const server = createServer((req, res) => {
      handled = handleMcpHttp(req, res, { gateway, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    try {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: addr.port,
        path: MCP_PATH,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": 64,
        },
      });
      req.on("error", () => {
        /* destroyed before complete */
      });
      req.write("{");
      const started = Date.now();
      while (handled === undefined && Date.now() - started < 1000) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.ok(handled, "server never saw the aborted request");
      req.destroy();
      await Promise.race([
        handled,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("handler hung after client abort")), 1000);
        }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("throttled connection identities are not evicted by flooding new identities", () => {
    const limit = 3;
    const throttle = new PairConnectionThrottle(limit, 60_000, 5);
    const attacker = { connectionId: "attacker", authenticated: false };
    const near = { connectionId: "near-limit", authenticated: false };
    const t0 = 1_700_000_000_000;

    for (let i = 0; i < limit; i += 1) throttle.noteFailure(attacker, t0);
    for (let i = 0; i < limit - 1; i += 1) throttle.noteFailure(near, t0 + 1);

    assert.throws(() => throttle.assert(attacker, t0 + 2), (err: unknown) => {
      return Boolean(err && typeof err === "object" && "code" in err && err.code === "PAIR_THROTTLED");
    });

    for (let i = 0; i < 40; i += 1) {
      const now = t0 + 10 + i;
      // Keep the near-limit identity recently seen so LRU prefers idle flood entries.
      throttle.assert(near, now);
      throttle.noteFailure({ connectionId: `flood-${i}`, authenticated: false }, now);
    }

    assert.throws(() => throttle.assert(attacker, t0 + 100), (err: unknown) => {
      return Boolean(err && typeof err === "object" && "code" in err && err.code === "PAIR_THROTTLED");
    });
    throttle.noteFailure(near, t0 + 101);
    assert.throws(() => throttle.assert(near, t0 + 102), (err: unknown) => {
      return Boolean(err && typeof err === "object" && "code" in err && err.code === "PAIR_THROTTLED");
    });
  });

  it("saturated throttle map fails closed for unknown identities", () => {
    const limit = 2;
    const max = 3;
    const throttle = new PairConnectionThrottle(limit, 60_000, max);
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < max; i += 1) {
      const id = { connectionId: `full-${i}`, authenticated: false };
      for (let n = 0; n < limit; n += 1) throttle.noteFailure(id, t0);
    }

    const fresh = { connectionId: "fresh", authenticated: false };
    assert.throws(() => throttle.assert(fresh, t0 + 1), (err: unknown) => {
      return Boolean(err && typeof err === "object" && "code" in err && err.code === "PAIR_THROTTLED");
    });
    throttle.noteFailure(fresh, t0 + 1);
    assert.throws(() => throttle.assert(fresh, t0 + 2), (err: unknown) => {
      return Boolean(err && typeof err === "object" && "code" in err && err.code === "PAIR_THROTTLED");
    });
    assert.throws(
      () => throttle.assert({ connectionId: "full-0", authenticated: false }, t0 + 2),
      (err: unknown) => {
        return Boolean(err && typeof err === "object" && "code" in err && err.code === "PAIR_THROTTLED");
      },
    );
  });

  it("Nexus stays locked and C3B flags are preserved", () => {
    assert.equal(FLAGS.FLOK_NEXUS_IQ_ENABLED, false);
    assert.equal(FLAGS.FLOK_GRAPH_MEMORY_ENABLED, false);
    assert.equal(FLAGS.FLOK_MCP_COMPUTERS_ENABLED, false);
    assertNexusDisabled();
    const runloop = new RunloopProvider({
      client: new MemoryRunloopControlPlane(),
      blueprint: "memory-linux-vm",
    });
    const caps = runloop.capabilities();
    assert.equal(caps.computerUse, true);
    assert.equal(caps.accessibility, false);
    assert.equal(caps.vnc, false);
    assert.equal(caps.pauseMemory, false);
  });
});
