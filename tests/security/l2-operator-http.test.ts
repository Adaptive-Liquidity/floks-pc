/**
 * L2 operator HTTP: loopback console, not the Grok wrapper token, eight tools.
 * Unpaid. FakeProvider. No paid Runloop.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.js";
import {
  MCP_PATH,
  MCP_TOOL_NAMES,
  McpGateway,
  handleMcpHttp,
} from "../../src/lib/mcp/index.js";
import { blobContainsSecret } from "../../src/lib/mcp/log.js";
import {
  OPERATOR_API_PREFIX,
  OPERATOR_CONSOLE_PATH,
  handleOperatorHttp,
  operatorConsoleHtml,
} from "../../src/lib/operator/index.js";

const WRAPPER = "operator-wrapper-not-for-logs";

async function listen(opts: {
  service: ComputerService;
  gateway: McpGateway;
  authToken?: string;
}): Promise<{ base: string; close: () => Promise<void> }> {
  const config = opts.authToken ? { authToken: opts.authToken } : {};
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (
      url.pathname === OPERATOR_CONSOLE_PATH ||
      url.pathname === `${OPERATOR_CONSOLE_PATH}/` ||
      url.pathname === "/" ||
      url.pathname.startsWith(`${OPERATOR_API_PREFIX}/`) ||
      url.pathname === OPERATOR_API_PREFIX
    ) {
      void handleOperatorHttp(req, res, { service: opts.service, config });
      return;
    }
    void handleMcpHttp(req, res, { gateway: opts.gateway, config, path: MCP_PATH });
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

describe("L2 operator HTTP", () => {
  it("console HTML names the four operator questions", () => {
    const html = operatorConsoleHtml();
    assert.match(html, /Live Node Console/);
    assert.match(html, /Bot Computers/);
    assert.match(html, /This bot has this computer/);
    assert.match(html, /What it sees/);
    assert.match(html, /Permissions/);
    assert.match(html, /Stop this computer/);
    assert.match(html, /click_element/);
    assert.doesNotMatch(html, /Nexus|AEON|Graphiti/i);
    assert.doesNotMatch(html, /innerHTML/);
  });

  it("loopback console lists computers and MCP still has eight tools", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({
      birdId: "bird-http",
      flockId: "flock-local",
    });
    const { base, close } = await listen({ service, gateway });
    try {
      const page = await fetch(`${base}${OPERATOR_CONSOLE_PATH}`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const html = await page.text();
      assert.match(html, /Live Node Console/);

      const snapRes = await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`);
      assert.equal(snapRes.status, 200);
      const snap = (await snapRes.json()) as {
        computers: Array<{ id: string; birdId: string }>;
        mcpToolCount: number;
      };
      assert.equal(snap.mcpToolCount, 8);
      assert.equal(snap.computers.length, 1);
      assert.equal(snap.computers[0]?.id, computer.id);

      const tools = await fetch(`${base}${MCP_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(tools.status, 200);
      const listed = (await tools.json()) as {
        result: { tools: Array<{ name: string }> };
      };
      assert.equal(listed.result.tools.length, MCP_TOOL_NAMES.length);
      assert.equal(listed.result.tools.length, 8);
    } finally {
      await close();
    }
  });

  it("loopback console stays usable without the Grok wrapper token; forwarded clients are refused", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const { base, close } = await listen({ service, gateway, authToken: WRAPPER });
    try {
      const page = await fetch(`${base}${OPERATOR_CONSOLE_PATH}`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Live Node Console/);

      const snap = await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`);
      assert.equal(snap.status, 200);

      const forwarded = await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`, {
        headers: { "x-forwarded-for": "203.0.113.9", authorization: `Bearer ${WRAPPER}` },
      });
      assert.equal(forwarded.status, 403);
      const forwardedText = await forwarded.text();
      assert.equal(forwardedText.includes(WRAPPER), false);
      assert.equal(blobContainsSecret(forwardedText, WRAPPER), false);
    } finally {
      await close();
    }
  });

  it("MCP listener does not serve the operator console", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const server = createServer((req, res) => {
      void handleMcpHttp(req, res, { gateway, path: MCP_PATH });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}`;
    try {
      const page = await fetch(`${base}${OPERATOR_CONSOLE_PATH}`);
      assert.equal(page.status, 404);
      const destroy = await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`);
      assert.equal(destroy.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it("destroy via operator API requires confirm + captured providerRef for the selected computer", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({
      birdId: "bird-stop",
      flockId: "flock-local",
    });
    const ref = computer.providerRef;
    assert.ok(ref);
    const { base, close } = await listen({ service, gateway });
    try {
      const bad = await fetch(
        `${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/destroy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true, providerRef: "dbx_WRONG" }),
        },
      );
      assert.equal(bad.status, 409);
      const still = await service.get(computer.id);
      assert.notEqual(still.state, "deleted");

      const ok = await fetch(
        `${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/destroy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true, providerRef: ref }),
        },
      );
      assert.equal(ok.status, 200);
      const body = (await ok.json()) as { computer: { state: string } };
      assert.equal(body.computer.state, "deleted");
    } finally {
      await close();
    }
  });

  it("operator observe does not persist screenshot bytes in events", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({
      birdId: "bird-see",
      flockId: "flock-local",
    });
    const { base, close } = await listen({ service, gateway });
    try {
      const res = await fetch(
        `${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/observe`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      assert.equal(res.status, 200);
      const obs = (await res.json()) as {
        observation: { hasScreenshot: boolean; screenWidth: number };
      };
      assert.equal(obs.observation.hasScreenshot, false);
      assert.equal(obs.observation.screenWidth, 1280);
      const events = await fetch(`${base}${OPERATOR_API_PREFIX}/events`);
      const payload = (await events.json()) as { events: unknown[] };
      const blob = JSON.stringify(payload);
      assert.doesNotMatch(blob, /screenshotBase64/);
    } finally {
      await close();
    }
  });
});
