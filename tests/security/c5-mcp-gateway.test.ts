/**
 * C5 gate: public MCP gateway.
 * MCP / account-level auth cannot identify a Bot and cannot access a computer.
 * Tools call ComputerService only. FakeProvider. Zero paid Runloop.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  ComputerService,
  FLAGS,
  FakeProvider,
  MemoryRunloopControlPlane,
  RunloopProvider,
  assertNexusDisabled,
} from "../../src/lib/computers/index.js";
import {
  MCP_PAIR_CONNECTION_FAILURE_LIMIT,
  MCP_PATH,
  MCP_TOOL_NAMES,
  McpGateway,
  RecordingLogger,
  blobContainsSecret,
  handleMcpHttp,
} from "../../src/lib/mcp/index.js";

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
    const result = res.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    assert.deepEqual(names, [...MCP_TOOL_NAMES]);
    assert.equal(names.length, 8);
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
