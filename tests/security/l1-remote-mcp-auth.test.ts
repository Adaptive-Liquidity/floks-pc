/**
 * L1 remote Grok Bot MCP: loopback stays local; public path requires HTTPS + wrapper auth.
 * Unpaid. FakeProvider. No paid Runloop.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ComputerError, ComputerService, FakeProvider } from "../../src/lib/computers/index.js";
import {
  MCP_PATH,
  MCP_TOOL_NAMES,
  McpGateway,
  assertRemoteMcpExposure,
  handleMcpHttp,
} from "../../src/lib/mcp/index.js";
import { RecordingLogger, blobContainsSecret } from "../../src/lib/mcp/log.js";
import { assertSafeMcpBind } from "../../src/mcp-server.js";

const WRAPPER = "wrapper-secret-not-for-logs";
const WRONG = "wrong-token-value";

async function listen(
  gateway: McpGateway,
  config: { authToken?: string },
  logger?: RecordingLogger,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handleMcpHttp(req, res, { gateway, config, logger, path: MCP_PATH });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return {
    base: `http://127.0.0.1:${addr.port}${MCP_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function post(
  base: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

describe("L1 remote MCP auth and routing", () => {
  it("loopback/local smoke remains local-only without wrapper auth", async () => {
    assert.doesNotThrow(() => assertSafeMcpBind("127.0.0.1", undefined));
    assert.doesNotThrow(() => assertRemoteMcpExposure({ listenHost: "127.0.0.1" }));
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const { base, close } = await listen(gateway, {});
    try {
      const res = await post(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      assert.equal(res.status, 200);
    } finally {
      await close();
    }
  });

  it("public/non-loopback path without token fails", () => {
    assert.throws(
      () => assertSafeMcpBind("0.0.0.0", undefined),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_BIND_UNAUTHENTICATED",
    );
    assert.throws(
      () =>
        assertRemoteMcpExposure({
          listenHost: "127.0.0.1",
          baseUrl: "https://mcp.example.test/mcp",
        }),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_REMOTE_AUTH_REQUIRED",
    );
  });

  it("rejects http and loopback as remote Grok Bot URLs", () => {
    assert.throws(
      () =>
        assertRemoteMcpExposure({
          baseUrl: "http://mcp.example.test/mcp",
          authToken: WRAPPER,
        }),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_REMOTE_URL_NOT_HTTPS",
    );
    assert.throws(
      () =>
        assertRemoteMcpExposure({
          baseUrl: "https://127.0.0.1/mcp",
          authToken: WRAPPER,
        }),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_REMOTE_URL_LOOPBACK",
    );
    assert.throws(
      () =>
        assertRemoteMcpExposure({
          baseUrl: "https://localhost/mcp",
          authToken: WRAPPER,
        }),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_REMOTE_URL_LOOPBACK",
    );
    assert.throws(
      () =>
        assertRemoteMcpExposure({
          baseUrl: "https://mcp.example.test/",
          authToken: WRAPPER,
        }),
      (err: unknown) => err instanceof ComputerError && err.code === "MCP_REMOTE_URL_PATH",
    );
  });

  it("public HTTPS URL with wrapper token is accepted", () => {
    assert.doesNotThrow(() =>
      assertRemoteMcpExposure({
        listenHost: "127.0.0.1",
        baseUrl: "https://mcp.example.test/mcp",
        authToken: WRAPPER,
      }),
    );
    assert.doesNotThrow(() => assertSafeMcpBind("0.0.0.0", WRAPPER));
  });

  it("public/non-loopback path with wrong or missing token fails; correct token succeeds", async () => {
    const service = new ComputerService(new FakeProvider());
    const logger = new RecordingLogger();
    const gateway = new McpGateway(service, { logger });
    const { base, close } = await listen(gateway, { authToken: WRAPPER }, logger);
    try {
      const missing = await post(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      assert.equal(missing.status, 401);
      assert.match(missing.text, /UNAUTHORIZED/);
      assert.equal(missing.text.includes(WRAPPER), false);
      assert.equal(missing.text.includes(WRONG), false);

      const wrong = await post(
        base,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { authorization: `Bearer ${WRONG}` },
      );
      assert.equal(wrong.status, 401);
      assert.match(wrong.text, /invalid MCP wrapper auth/);
      assert.equal(wrong.text.includes(WRAPPER), false);
      assert.equal(wrong.text.includes(WRONG), false);

      const ok = await post(
        base,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { authorization: `Bearer ${WRAPPER}` },
      );
      assert.equal(ok.status, 200);
      const listed = ok.json as {
        result: { tools: Array<{ name: string }> };
      };
      const names = listed.result.tools.map((t) => t.name);
      assert.deepEqual(names, [...MCP_TOOL_NAMES]);
      assert.equal(names.length, 8);
    } finally {
      await close();
    }
    const blob = logger.blob();
    assert.equal(blobContainsSecret(blob, WRAPPER), false);
    assert.equal(blobContainsSecret(blob, WRONG), false);
    assert.match(blob, /mcp.http_unauthorized/);
  });
});
