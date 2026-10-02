import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, ComputerUseNotAvailable, FakeProvider, ProviderUnavailable } from "../../src/lib/computers/index.ts";
import type { ComputerSpec, ExecRequest, ExecResult, ObserveRequest } from "../../src/lib/computers/types.ts";
import { McpGateway } from "../../src/lib/mcp/handler.ts";
import { RecordingLogger } from "../../src/lib/mcp/log.ts";
import { POST as mcpPost } from "../../web/app/mcp/route.ts";

const STARTING = "Your computer is starting. Try again in a minute.";
const ORIGIN = "https://staxions-preview.vercel.app";

class ShutdownProvider extends FakeProvider {
  down = new Set<string>();
  wakes = 0;
  hangWake = false;
  failResume = false;
  crashAfterWake = false;
  holdPause = false;
  starting = false;
  cdpReady = true;
  statusCalls = 0;
  axThrows = false;
  axCalls = 0;

  override async provision(spec: ComputerSpec) {
    const created = await super.provision(spec);
    return created;
  }

  override async status(ref: string) {
    this.statusCalls += 1;
    if (this.down.has(ref)) return { state: "stopped" as const };
    if (this.starting) return { state: "provisioning" as const };
    return super.status(ref);
  }

  override async pause(ref: string): Promise<void> {
    if (this.holdPause) return;
    await super.pause(ref);
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
    if (this.crashAfterWake) throw new Error("crashed after resume");
  }

  override async observe(ref: string, request: ObserveRequest) {
    if (request.includeAccessibility === true && this.axThrows) {
      this.axCalls += 1;
      throw new ComputerUseNotAvailable();
    }
    const shot = await super.observe(ref, { ...request, includeAccessibility: false });
    if (request.includeAccessibility === true && this.cdpReady) {
      return super.observe(ref, request);
    }
    if (request.includeScreenshot === true) {
      shot.screenshotBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    }
    delete shot.accessibilitySummary;
    return shot;
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
    const pair = await tool(gateway, "computer_pair", {}, bound);
    assert.equal(pair.isError, false);
    assert.equal(pair.body.connected, true);
    assert.equal(pair.body.state, "running");
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

  it("tells the bot files are gone before a rebuilt computer is used", async () => {
    const provider = new ShutdownProvider();
    provider.failResume = true;
    const service = new ComputerService(provider);
    const logger = new RecordingLogger();
    const gateway = new McpGateway(service, { logger });
    const computer = await service.requestComputer({ birdId: "bird-re", flockId: "flock-wake" });
    const oldRef = computer.providerRef;
    assert.ok(oldRef);
    provider.down.add(oldRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const bound = { capabilityId: paired.capabilityId, flockId: computer.flockId };
    const exec = await tool(gateway, "computer_exec", { argv: ["echo", "hi"] }, bound);
    assert.equal(exec.isError, true);
    assert.equal(exec.body.message, "Your computer had to be rebuilt; files from before are gone");
    assert.equal(JSON.stringify(exec.body).includes("DEVBOX_SHUTDOWN"), false);
    assert.match(logger.blob(), /mcp.computer_rebuilt/);
    const kept = await service.get(computer.id);
    assert.equal(kept.id, computer.id);
    assert.notEqual(kept.providerRef, oldRef);
    assert.equal((await service.getCapability(paired.capabilityId)).computerId, computer.id);
    const again = await tool(gateway, "computer_exec", { argv: ["echo", "hi"] }, bound);
    assert.equal(again.isError, false);
    assert.equal(again.body.exit_code, 0);
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

  it("after a rebuild, status and observe see a running computer", async () => {
    const provider = new ShutdownProvider();
    provider.failResume = true;
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-heal", flockId: "flock-wake" });
    assert.ok(computer.providerRef);
    provider.down.add(computer.providerRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const bound = { capabilityId: paired.capabilityId, flockId: computer.flockId };
    const exec = await tool(gateway, "computer_exec", { argv: ["echo", "hi"] }, bound);
    assert.equal(exec.isError, true);
    assert.equal(exec.body.code, "COMPUTER_REBUILT");
    const status = await tool(gateway, "computer_status", {}, bound);
    assert.equal(status.isError, false);
    assert.equal(status.body.state, "running");
    const observe = await tool(gateway, "computer_observe", { include_screenshot: true }, bound);
    assert.equal(observe.isError, false);
    assert.equal(observe.body.has_screenshot, true);
    const stored = await service.get(computer.id);
    assert.ok(stored.state === "ready" || stored.state === "running");
  });

  it("heals a stored paused computer when the provider is already running", async () => {
    const provider = new ShutdownProvider();
    provider.holdPause = true;
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-paused", flockId: "flock-wake" });
    await service.pauseThisComputer(computer.id);
    assert.equal((await service.get(computer.id)).state, "paused");
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const status = await tool(gateway, "computer_status", {}, {
      capabilityId: paired.capabilityId,
      flockId: computer.flockId,
    });
    assert.equal(status.isError, false);
    assert.equal(status.body.state, "running");
    assert.equal((await service.get(computer.id)).state, "running");
  });

  it("heals a stored waking computer left by a crashed call", async () => {
    const provider = new ShutdownProvider();
    provider.crashAfterWake = true;
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-crash", flockId: "flock-wake" });
    assert.ok(computer.providerRef);
    provider.down.add(computer.providerRef);
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const bound = { capabilityId: paired.capabilityId, flockId: computer.flockId };
    const crashed = await tool(gateway, "computer_exec", { argv: ["echo", "hi"] }, bound);
    assert.equal(crashed.isError, true);
    assert.equal((await service.get(computer.id)).state, "waking");
    provider.crashAfterWake = false;
    const status = await tool(gateway, "computer_status", {}, bound);
    assert.equal(status.isError, false);
    assert.equal(status.body.state, "running");
    assert.ok(["ready", "running"].includes((await service.get(computer.id)).state));
  });

  it("polls a starting computer at most about ten times in five fake seconds", async () => {
    const provider = new ShutdownProvider();
    provider.starting = true;
    let now = 0;
    const service = new ComputerService(provider, {
      now: () => now,
      wakeTimeoutMs: 5_000,
      sleep: async (ms: number) => {
        now += ms;
      },
    });
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-poll", flockId: "flock-wake" });
    const before = provider.statusCalls;
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const status = await tool(gateway, "computer_status", {}, {
      capabilityId: paired.capabilityId,
      flockId: computer.flockId,
    });
    assert.equal(status.isError, false);
    assert.equal(status.body.state, "starting");
    assert.equal(status.body.retry_after_ms, 15000);
    assert.ok(provider.statusCalls - before <= 10);
  });

  it("returns a screenshot and accessibility_pending when CDP is not ready", async () => {
    const provider = new ShutdownProvider();
    provider.cdpReady = false;
    let now = 0;
    const service = new ComputerService(provider, {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    });
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-ax", flockId: "flock-wake" });
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const observe = await tool(
      gateway,
      "computer_observe",
      { include_screenshot: true, include_accessibility: true },
      { capabilityId: paired.capabilityId, flockId: computer.flockId },
    );
    assert.equal(observe.isError, false);
    assert.equal(observe.body.has_screenshot, true);
    assert.equal(observe.body.accessibility_pending, true);
    assert.equal(observe.body.retry_after_ms, 10000);
    assert.equal(observe.body.accessibility_summary, undefined);
  });

  it("returns a screenshot when the accessibility dump is not available yet", async () => {
    const provider = new ShutdownProvider();
    provider.axThrows = true;
    let now = 0;
    const service = new ComputerService(provider, {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    });
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({ birdId: "bird-ax-throw", flockId: "flock-wake" });
    const paired = await service.issueBoundCapability(computer.id, computer.flockId);
    const observe = await tool(
      gateway,
      "computer_observe",
      { include_screenshot: true, include_accessibility: true },
      { capabilityId: paired.capabilityId, flockId: computer.flockId },
    );
    assert.equal(observe.isError, false);
    assert.equal(observe.body.has_screenshot, true);
    assert.equal(observe.body.accessibility_pending, true);
    assert.equal(observe.body.accessibility_summary, undefined);
    assert.ok(provider.axCalls > 1);
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
