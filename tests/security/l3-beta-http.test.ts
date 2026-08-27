/**
 * L3 operator beta HTTP. Loopback. Unpaid. FakeProvider.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  BetaRegistry,
  ComputerService,
  FakeProvider,
  MemoryBetaStore,
  MemoryControlPlaneStore,
  BETA_COST_WARNING,
} from "../../src/lib/computers/index.js";
import { MCP_PATH, MCP_TOOL_NAMES, McpGateway, handleMcpHttp } from "../../src/lib/mcp/index.js";
import {
  OPERATOR_API_PREFIX,
  handleOperatorHttp,
  operatorConsoleHtml,
} from "../../src/lib/operator/index.js";

async function listen(service: ComputerService): Promise<{
  base: string;
  close: () => Promise<void>;
}> {
  const gateway = new McpGateway(service);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/operator") || url.pathname === "/console" || url.pathname === "/") {
      void handleOperatorHttp(req, res, { service });
      return;
    }
    void handleMcpHttp(req, res, { gateway, path: MCP_PATH });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe("L3 beta operator HTTP", () => {
  it("console still names cost and click_element; MCP stays at eight tools", () => {
    const html = operatorConsoleHtml();
    assert.match(html, /click_element/);
    assert.match(html, /Not metered yet \(L7\)/);
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("waitlist then approve then snapshot shows cap and cost warning", async () => {
    const registry = new BetaRegistry(new MemoryBetaStore());
    const service = new ComputerService(new FakeProvider(), {
      store: new MemoryControlPlaneStore(),
      ownerId: "owner-http",
      beta: {
        enabled: true,
        maxActive: 1,
        idleTtlMs: 60_000,
        costWarning: BETA_COST_WARNING,
      },
      betaRegistry: registry,
    });
    const { base, close } = await listen(service);
    try {
      const wait = await fetch(`${base}${OPERATOR_API_PREFIX}/beta/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: "owner-http" }),
      });
      assert.equal(wait.status, 200);
      const approve = await fetch(`${base}${OPERATOR_API_PREFIX}/beta/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: "owner-http" }),
      });
      assert.equal(approve.status, 200);
      await service.requestComputer({ birdId: "bird-http", flockId: "flock-http" });
      const snap = await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`);
      const body = (await snap.json()) as {
        beta: { enabled: boolean; maxActive: number; active: number; costWarning: string };
        mcpToolCount: number;
      };
      assert.equal(body.mcpToolCount, 8);
      assert.equal(body.beta.enabled, true);
      assert.equal(body.beta.maxActive, 1);
      assert.equal(body.beta.active, 1);
      assert.match(body.beta.costWarning, /does not meter/);
      const limits = await fetch(`${base}${OPERATOR_API_PREFIX}/limitations`);
      const lim = (await limits.json()) as { limitations: string[] };
      assert.ok(lim.limitations.some((l) => /click_element/i.test(l)));
      const packetRes = await fetch(`${base}${OPERATOR_API_PREFIX}/debug-packet`);
      assert.equal(packetRes.status, 200);
      const packetText = await packetRes.text();
      assert.doesNotMatch(packetText, /"providerRef"/);
      assert.doesNotMatch(packetText, /screenshotBase64/);
    } finally {
      await close();
    }
  });
});
