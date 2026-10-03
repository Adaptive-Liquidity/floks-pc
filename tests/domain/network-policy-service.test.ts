/**
 * ComputerService fail-closed network gate. Unpaid FakeProvider subclass.
 * Does not call Runloop.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ComputerService,
  FakeProvider,
  NetworkPolicyRejected,
  capabilityAuth,
  evaluateVendorNetworkPolicy,
  parsePaidNetworkPolicyConfig,
} from "../../src/lib/computers/index.ts";
import type {
  ComputerSpec,
  NetworkPolicyAttachment,
  ProviderComputer,
  RestoreRequest,
} from "../../src/lib/computers/types.ts";

function attachment(): NetworkPolicyAttachment {
  const config = parsePaidNetworkPolicyConfig({
    FLOK_RUNLOOP_NETWORK_POLICY_ID: "npol_service_test",
    FLOK_RUNLOOP_NETWORK_PROFILE: "governed-github",
    FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY: "false",
    FLOK_RUNLOOP_ALLOW_MCP_GATEWAY: "false",
    FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS: "false",
  });
  const decision = evaluateVendorNetworkPolicy(
    config,
    {
      id: config.policyId,
      update_time_ms: 7,
      egress: {
        allow_all: false,
        allow_devbox_to_devbox: false,
        allow_agent_gateway: false,
        allow_mcp_gateway: false,
        allow_runloop_mirrors: false,
        allowed_hostnames: [],
        allowed_cidrs: [],
      },
    },
    "2026-10-03T18:00:00.000Z",
    true,
  );
  if (!decision.ok) throw new Error("fixture policy should validate");
  return decision.attachment;
}

class PaidFake extends FakeProvider {
  attachment: NetworkPolicyAttachment | null = attachment();
  wakeCalls = 0;

  requiresPaidNetworkPolicy(): boolean {
    return true;
  }

  override async provision(spec: ComputerSpec): Promise<ProviderComputer> {
    const created = await super.provision(spec);
    if (!this.attachment) return created;
    return { ...created, networkAttachment: this.attachment };
  }

  override async restore(request: RestoreRequest): Promise<ProviderComputer> {
    const created = await super.restore(request);
    if (!this.attachment) return created;
    return { ...created, networkAttachment: this.attachment };
  }

  override async wake(ref: string): Promise<void | NetworkPolicyAttachment> {
    this.wakeCalls += 1;
    if (!this.attachment) {
      throw new NetworkPolicyRejected("NETWORK_POLICY_LEGACY", "legacy devbox has no network policy");
    }
    await super.wake(ref);
    return this.attachment;
  }

  async verifyNetworkAttachment(): Promise<NetworkPolicyAttachment> {
    if (!this.attachment) {
      throw new NetworkPolicyRejected(
        "NETWORK_POLICY_LEGACY",
        "legacy devbox has no network policy",
      );
    }
    return this.attachment;
  }
}

describe("ComputerService paid network policy", () => {
  it("records a validated attachment and refuses a policy-less paid create", async () => {
    const provider = new PaidFake();
    const service = new ComputerService(provider);
    const computer = await service.requestComputer({ birdId: "bird-net", flockId: "flock-net" });
    assert.equal(computer.networkAttachment?.policyId, "npol_service_test");
    assert.equal(computer.networkAttachment?.enforcement, "eventually-consistent");
    assert.equal(computer.networkAttachment?.allowAll, false);

    provider.attachment = null;
    await assert.rejects(
      () => service.requestComputer({ birdId: "bird-open", flockId: "flock-net" }),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_UNATTACHED",
    );
    assert.equal(provider.liveRefs().some((ref) => ref !== computer.providerRef), false);
  });

  it("does not resume a legacy computer and does not fall back to unrestricted", async () => {
    const provider = new PaidFake();
    const service = new ComputerService(provider);
    const computer = await service.requestComputer({ birdId: "bird-legacy", flockId: "flock-net" });
    await service.transition(computer.id, "paused");
    provider.attachment = null;
    provider.wakeCalls = 0;
    await assert.rejects(
      () => service.transition(computer.id, "running"),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_LEGACY",
    );
    assert.equal(provider.wakeCalls, 1);
    const parked = await service.get(computer.id);
    assert.equal(parked.state, "stopped");
    assert.match(parked.recoveryNote ?? "", /unrestricted egress was refused/);
  });

  it("checks the attached policy before exec on an already-running computer", async () => {
    const provider = new PaidFake();
    const service = new ComputerService(provider);
    const computer = await service.requestComputer({ birdId: "bird-exec", flockId: "flock-net" });
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, { birdId: computer.birdId, flockId: computer.flockId });
    provider.attachment = null;
    await assert.rejects(
      () =>
        service.exec(capabilityAuth(paired.token), computer.id, {
          argv: ["true"],
        }),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_LEGACY",
    );
    const parked = await service.get(computer.id);
    assert.equal(parked.state, "stopped");
  });
});
