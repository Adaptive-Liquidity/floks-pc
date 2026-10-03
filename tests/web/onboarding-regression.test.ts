import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, FakeProvider, MemoryControlPlaneStore, ProviderNeedsReplacement } from "../../src/lib/computers/index.ts";
import type { ComputerSpec, ExecRequest, ExecResult } from "../../src/lib/computers/types.ts";
import { McpGateway } from "../../src/lib/mcp/handler.ts";
import { blobContainsSecret } from "../../src/lib/mcp/log.ts";
import { MCP_INSTANCE_ID, vercelMcpLogger } from "../../web/lib/mcp-log.ts";

const ORIGIN = "https://staxions-preview.vercel.app";

function account(flock: string) {
  return {
    perBotKeys: true as const,
    account: { subject: "user_a", flock, origin: ORIGIN },
  };
}

async function call(
  gateway: McpGateway,
  name: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const res = await gateway.handleJsonRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    extra,
  );
  assert.ok(res && !Array.isArray(res));
  const result = (res as { result: { isError?: boolean; structuredContent?: Record<string, unknown> } }).result;
  return { isError: result.isError === true, body: result.structuredContent ?? {} };
}

async function coldAndWarm(flock: string) {
  const store = new MemoryControlPlaneStore();
  const provider = new FakeProvider();
  const warm = new ComputerService(provider, { store });
  const computer = await warm.requestComputer({ birdId: `bird-${flock}`, flockId: flock });
  const cold = new ComputerService(provider, { store });
  await cold.hydrate();
  const claim = await warm.createBotClaim({ flockId: flock, subject: "user_a" });
  await warm.approveBotClaim({
    claimId: claim.claimId,
    flockId: flock,
    computerId: computer.id,
    botLabel: "Ada",
  });
  return { warm, cold, claim, computer, account: account(flock) };
}

describe("onboarding regressions", () => {
  it("lets a pre-redeem instance use a key another instance just minted", async () => {
    const { warm, cold, claim, account: ctx } = await coldAndWarm("flock-f8");
    const gatewayY = new McpGateway(warm);
    const paired = await call(gatewayY, "computer_pair", { pair_code: claim.code }, ctx);
    assert.equal(paired.isError, false);
    const token = String(paired.body.capability_token);
    const gatewayX = new McpGateway(cold);
    const exec = await call(gatewayX, "computer_exec", { capability_token: token, argv: ["echo", "x"] }, ctx);
    assert.equal(exec.isError, false, JSON.stringify(exec.body));
    const observe = await call(
      gatewayX,
      "computer_observe",
      { capability_token: token, include_screenshot: true },
      ctx,
    );
    assert.equal(observe.isError, false, JSON.stringify(observe.body));
    assert.equal(observe.body.has_screenshot, true);
    const status = await call(gatewayX, "computer_status", { capability_token: token }, ctx);
    assert.equal(status.isError, false, JSON.stringify(status.body));
    const warmExec = await call(gatewayY, "computer_exec", { capability_token: token, argv: ["echo", "y"] }, ctx);
    assert.equal(warmExec.isError, false, JSON.stringify(warmExec.body));
    const warmObserve = await call(
      gatewayY,
      "computer_observe",
      { capability_token: token, include_screenshot: true },
      ctx,
    );
    assert.equal(warmObserve.isError, false, JSON.stringify(warmObserve.body));
  });

  it("alternates a cold and a warm instance across the reported tool sequence", async () => {
    const { warm, cold, claim, account: ctx } = await coldAndWarm("flock-seq");
    const gateways = [new McpGateway(cold), new McpGateway(warm)];
    const steps: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: "computer_pair", args: { pair_code: claim.code } },
      { name: "computer_status", args: {} },
      { name: "computer_observe", args: { include_screenshot: true } },
      { name: "computer_exec", args: { argv: ["echo", "seq"] } },
      { name: "computer_observe", args: { include_screenshot: true } },
      { name: "computer_observe", args: { include_screenshot: true } },
      { name: "computer_act", args: { actions: [{ type: "wait", durationMs: 10 }] } },
      { name: "computer_fs", args: { operation: "list", path: "." } },
      { name: "computer_status", args: {} },
    ];
    let token = "";
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      assert.ok(step);
      const args = { ...step.args };
      if (token) args.capability_token = token;
      const result = await call(gateways[i % 2]!, step.name, args, ctx);
      assert.equal(result.isError, false, `${step.name}: ${JSON.stringify(result.body)}`);
      if (typeof result.body.capability_token === "string") token = result.body.capability_token;
    }
    assert.ok(token);
  });

  it("does not rebuild a computer that is only still provisioning", async () => {
    const provider = new SlowReadyProvider();
    let now = 0;
    const service = new ComputerService(provider, {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    });
    const flock = "flock-fresh";
    const computer = await service.requestComputer({ birdId: "bird-fresh", flockId: flock });
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({
      claimId: claim.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    const gateway = new McpGateway(service);
    const ctx = account(flock);
    const paired = await call(gateway, "computer_pair", { pair_code: claim.code }, ctx);
    assert.equal(paired.isError, false);
    const token = String(paired.body.capability_token);
    for (const step of [
      { name: "computer_status", args: { capability_token: token } },
      { name: "computer_observe", args: { capability_token: token, include_screenshot: true } },
      { name: "computer_exec", args: { capability_token: token, argv: ["echo", "fresh"] } },
      { name: "computer_observe", args: { capability_token: token, include_screenshot: true } },
      { name: "computer_status", args: { capability_token: token } },
    ]) {
      const result = await call(gateway, step.name, step.args, ctx);
      assert.equal(result.isError, false, `${step.name}: ${JSON.stringify(result.body)}`);
      assert.notEqual(result.body.code, "COMPUTER_REBUILT");
    }
    assert.equal(provider.provisions, 1);
  });

  it("rebuilds a stopped box once and then uses the replacement", async () => {
    const provider = new StoppedOnceProvider();
    const service = new ComputerService(provider);
    const flock = "flock-rebuild";
    const computer = await service.requestComputer({ birdId: "bird-rebuild", flockId: flock });
    const before = computer.providerRef;
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({
      claimId: claim.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    const gateway = new McpGateway(service);
    const ctx = account(flock);
    const paired = await call(gateway, "computer_pair", { pair_code: claim.code }, ctx);
    const token = String(paired.body.capability_token);
    const first = await call(gateway, "computer_exec", { capability_token: token, argv: ["echo", "old"] }, ctx);
    assert.equal(first.body.code, "COMPUTER_REBUILT");
    const second = await call(gateway, "computer_status", { capability_token: token }, ctx);
    assert.equal(second.isError, false, JSON.stringify(second.body));
    const after = (await service.get(computer.id)).providerRef;
    assert.notEqual(after, before);
    assert.equal(provider.provisions, 2);
  });

  it("logs a pair and exec without the pair code or the key", async () => {
    const previous = process.env.VERCEL_ENV;
    delete process.env.VERCEL_ENV;
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service, { logger: vercelMcpLogger(), instanceId: MCP_INSTANCE_ID });
    const flock = "flock-log";
    const computer = await service.requestComputer({ birdId: "bird-log", flockId: flock });
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({
      claimId: claim.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    const lines: string[] = [];
    const original = console.info;
    console.info = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    try {
      const ctx = account(flock);
      const paired = await call(gateway, "computer_pair", { pair_code: claim.code }, ctx);
      const token = String(paired.body.capability_token);
      await call(gateway, "computer_exec", { capability_token: token, argv: ["echo", "quiet"] }, ctx);
      const blob = lines.join("\n");
      assert.match(blob, /mcp\.tools_call/);
      assert.match(blob, new RegExp(MCP_INSTANCE_ID));
      assert.equal(blobContainsSecret(blob, claim.code), false);
      assert.equal(blobContainsSecret(blob, token), false);
    } finally {
      console.info = original;
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  });
});

class SlowReadyProvider extends FakeProvider {
  provisions = 0;
  statusCalls = 0;

  override async provision(spec: ComputerSpec) {
    this.provisions += 1;
    return super.provision(spec);
  }

  override async status(ref: string) {
    this.statusCalls += 1;
    if (this.statusCalls <= 2) return { state: "provisioning" as const };
    return super.status(ref);
  }
}

class StoppedOnceProvider extends FakeProvider {
  provisions = 0;
  private firstRef: string | null = null;

  override async provision(spec: ComputerSpec) {
    this.provisions += 1;
    const created = await super.provision(spec);
    if (this.provisions === 1) this.firstRef = created.providerRef;
    return created;
  }

  override async status(ref: string) {
    if (ref === this.firstRef) return { state: "stopped" as const };
    return super.status(ref);
  }

  override async wake(ref: string): Promise<void> {
    if (ref === this.firstRef) throw new ProviderNeedsReplacement("runloop");
  }

  override async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    if (ref === this.firstRef) throw new ProviderNeedsReplacement("runloop");
    return super.exec(ref, request);
  }
}
