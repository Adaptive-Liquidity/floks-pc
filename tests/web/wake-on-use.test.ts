import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, FakeProvider, ProviderUnavailable } from "../../src/lib/computers/index.ts";
import type { ComputerSpec, ExecRequest, ExecResult } from "../../src/lib/computers/types.ts";
import { McpGateway } from "../../src/lib/mcp/handler.ts";
import { POST as mcpPost } from "../../web/app/mcp/route.ts";

const STARTING = "Your computer is starting. Try again in a minute.";
const ORIGIN = "https://staxions-preview.vercel.app";

class ShutdownProvider extends FakeProvider {
  down = new Set<string>();
  wakes = 0;
  hangWake = false;
  failResume = false;

  override async provision(spec: ComputerSpec) {
    const created = await super.provision(spec);
    return created;
  }

  override async status(ref: string) {
    if (this.down.has(ref)) return { state: "stopped" as const };
    return super.status(ref);
  }

  override async wake(ref: string): Promise<void> {
    this.wakes += 1;
    if (this.hangWake) return new Promise(() => undefined);
    if (this.failResume) {
      throw new ProviderUnavailable(
        "runloop",
        "Devbox is not in proper state. Current status: DEVBOX_SHUTDOWN. Expected: DEVBOX_RUNNING",
      );
    }
    this.down.delete(ref);
  }

  override async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    if (this.down.has(ref)) {
      throw new ProviderUnavailable(
        "runloop",
        "Devbox is not in proper state. Current status: DEVBOX_SHUTDOWN. Expected: DEVBOX_RUNNING",
      );
    }
    return super.exec(ref, request);
  }
}

async function tool(
  gateway: McpGateway,
  name: string,
  args: Record<string, unknown>,
  bound: { capabilityId: string; flockId: string },
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const res = await gateway.handleJsonRpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
    { bound },
  );
  assert.ok(res && !Array.isArray(res));
  const result = (res as { result: { isError?: boolean; structuredContent?: Record<string, unknown> } })
    .result;
  return { isError: result.isError === true, body: result.structuredContent ?? {} };
}

describe("wake a shut-down computer on use", () => {
  it("computer_exec wakes a shut-down devbox and then succeeds", async () => {
    const provider = new ShutdownProvider();
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-wake", flockId: "flock-wake" });
    assert.ok(computer.providerRef);
    provider.down.add(computer.providerRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const bound = { capabilityId: paired.capabilityId, flockId: computer.flockId };
    const exec = await tool(gateway, "computer_exec", { argv: ["echo", "hi"] }, bound);
    assert.equal(exec.isError, false);
    assert.equal(exec.body.exit_code, 0);
    assert.equal(provider.wakes, 1);
    assert.equal(provider.down.has(computer.providerRef), false);
  });

  it("returns a friendly error when waking exceeds the timeout", async () => {
    const provider = new ShutdownProvider();
    provider.hangWake = true;
    const service = new ComputerService(provider, { wakeTimeoutMs: 40 });
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-slow", flockId: "flock-wake" });
    assert.ok(computer.providerRef);
    provider.down.add(computer.providerRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const bound = { capabilityId: paired.capabilityId, flockId: computer.flockId };
    const exec = await Promise.race([
      tool(gateway, "computer_exec", { argv: ["echo", "hi"] }, bound),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("wake hung past the test budget")), 800);
      }),
    ]);
    assert.equal(exec.isError, true);
    assert.equal(exec.body.message, STARTING);
    assert.equal(JSON.stringify(exec.body).includes("DEVBOX_SHUTDOWN"), false);
  });

  it("computer_status on a sleeping computer returns state and is not an error", async () => {
    const provider = new ShutdownProvider();
    const service = new ComputerService(provider, { wakeTimeoutMs: 40 });
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-status", flockId: "flock-wake" });
    assert.ok(computer.providerRef);
    provider.down.add(computer.providerRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const status = await tool(
      gateway,
      "computer_status",
      {},
      { capabilityId: paired.capabilityId, flockId: computer.flockId },
    );
    assert.equal(status.isError, false);
    assert.ok(status.body.state === "sleeping" || status.body.state === "starting" || status.body.state === "running");
    assert.equal(provider.wakes >= 1, true);
  });

  it("re-provisions a shut-down devbox that cannot resume and keeps the computer id", async () => {
    const provider = new ShutdownProvider();
    provider.failResume = true;
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-re", flockId: "flock-wake" });
    const oldRef = computer.providerRef;
    assert.ok(oldRef);
    provider.down.add(oldRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const exec = await tool(
      gateway,
      "computer_exec",
      { argv: ["echo", "hi"] },
      { capabilityId: paired.capabilityId, flockId: computer.flockId },
    );
    const kept = await service.get(computer.id);
    assert.equal(exec.isError, false);
    assert.equal(kept.id, computer.id);
    assert.notEqual(kept.providerRef, oldRef);
    assert.equal((await service.getCapability(paired.capabilityId)).computerId, computer.id);
  });

  it("does not wake a seat that is not active", async () => {
    const provider = new ShutdownProvider();
    const service = new ComputerService(provider);
    service.setWakeAdmission(async () => false);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-seat", flockId: "flock-wake" });
    assert.ok(computer.providerRef);
    provider.down.add(computer.providerRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const bound = { capabilityId: paired.capabilityId, flockId: computer.flockId };
    const status = await tool(gateway, "computer_status", {}, bound);
    assert.equal(status.isError, false);
    assert.equal(status.body.state, "sleeping");
    assert.equal(provider.wakes, 0);
  });
});

describe("unauthenticated /mcp", () => {
  it("returns 401 with resource_metadata for initialize and tools/list", async () => {
    for (const method of ["initialize", "tools/list"]) {
      const res = await mcpPost(
        new Request(`${ORIGIN}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        }),
      );
      assert.equal(res.status, 401);
      const auth = res.headers.get("www-authenticate") ?? "";
      assert.match(auth, /resource_metadata=/);
      assert.match(auth, /oauth-protected-resource/);
    }
  });
});
