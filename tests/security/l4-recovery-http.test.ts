/**
 * L4 operator recovery HTTP. Loopback. Unpaid. FakeProvider.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import {
  ComputerService,
  FakeProvider,
  MemoryControlPlaneStore,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";
import {
  OPERATOR_API_PREFIX,
  handleOperatorHttp,
  operatorConsoleHtml,
} from "../../src/lib/operator/index.js";

async function listen(
  service: ComputerService,
  mutateReq?: (req: IncomingMessage) => void,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    mutateReq?.(req);
    void handleOperatorHttp(req, res, { service });
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

describe("L4 recovery operator HTTP", () => {
  it("console stays eight-tool, loopback, and names checkpoint/recovery", () => {
    const html = operatorConsoleHtml();
    assert.equal(MCP_TOOL_NAMES.length, 8);
    assert.match(html, /Checkpoint workspace/);
    assert.match(html, /Recover from latest checkpoint/);
    assert.match(html, /cleanup needed/);
    assert.match(html, /Loopback only/);
  });

  it("checkpoint then recover via loopback operator API restores the computer", async () => {
    const service = new ComputerService(new FakeProvider(), {
      store: new MemoryControlPlaneStore(),
    });
    const computer = await service.requestComputer({ birdId: "bird-http", flockId: "flock-h" });
    const { base, close } = await listen(service);
    try {
      const ck = await fetch(`${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/checkpoint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(ck.status, 200);
      const body = (await ck.json()) as {
        computer: { checkpointStatus: string; checkpointId: string };
      };
      assert.equal(body.computer.checkpointStatus, "ready");
      assert.ok(body.computer.checkpointId);
      const rec = await fetch(`${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(rec.status, 200);
      const recovered = (await rec.json()) as {
        computer: { state: string; checkpointStatus: string };
      };
      assert.equal(recovered.computer.state, "ready");
      assert.equal(recovered.computer.checkpointStatus, "restored");
    } finally {
      await close();
    }
  });

  it("observe while paused is retryable over HTTP", async () => {
    const service = new ComputerService(new FakeProvider(), {
      store: new MemoryControlPlaneStore(),
    });
    const computer = await service.requestComputer({ birdId: "bird-pause", flockId: "flock-h" });
    await service.pauseThisComputer(computer.id);
    const { base, close } = await listen(service);
    try {
      const res = await fetch(`${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/observe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OBSERVE_RETRYABLE");
    } finally {
      await close();
    }
  });

  it("recover without checkpoint is 409 CHECKPOINT_REQUIRED", async () => {
    const service = new ComputerService(new FakeProvider(), {
      store: new MemoryControlPlaneStore(),
    });
    const computer = await service.requestComputer({ birdId: "bird-none", flockId: "flock-h" });
    const { base, close } = await listen(service);
    try {
      const res = await fetch(`${base}${OPERATOR_API_PREFIX}/computers/${computer.id}/recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "CHECKPOINT_REQUIRED");
    } finally {
      await close();
    }
  });

  it("forwarded clients are still 403", async () => {
    const service = new ComputerService(new FakeProvider(), {
      store: new MemoryControlPlaneStore(),
    });
    const { base, close } = await listen(service, (req) => {
      req.headers["x-forwarded-for"] = "1.2.3.4";
    });
    try {
      const res = await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`);
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  it("snapshot and debug packet omit snapshot refs and tokens", async () => {
    const service = new ComputerService(new FakeProvider(), {
      store: new MemoryControlPlaneStore(),
    });
    const computer = await service.requestComputer({ birdId: "bird-sec", flockId: "flock-h" });
    await service.checkpointThisComputer(computer.id);
    const { base, close } = await listen(service);
    try {
      const snap = await (await fetch(`${base}${OPERATOR_API_PREFIX}/snapshot`)).text();
      assert.doesNotMatch(snap, /providerSnapshotRef/);
      assert.doesNotMatch(snap, /"token"/);
      const packet = await (await fetch(`${base}${OPERATOR_API_PREFIX}/debug-packet`)).text();
      assert.doesNotMatch(packet, /providerSnapshotRef/);
      assert.doesNotMatch(packet, /screenshotBase64/);
    } finally {
      await close();
    }
  });
});
