import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NetworkPolicyRejected } from "../../src/lib/computers/errors.ts";
import {
  evaluateVendorNetworkPolicy,
  parsePaidNetworkPolicyConfig,
} from "../../src/lib/computers/network-policy.ts";
import { MemoryRunloopControlPlane, RunloopProvider } from "../../src/lib/computers/providers/runloop.ts";
import { redactControlPlaneSecrets } from "../../src/lib/computers/providers/runloop-client.ts";

function configEnv(extra: Record<string, string> = {}) {
  return parsePaidNetworkPolicyConfig({
    FLOK_RUNLOOP_NETWORK_POLICY_ID: "npol_memory_test",
    FLOK_RUNLOOP_NETWORK_PROFILE: "governed-github",
    FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY: "false",
    FLOK_RUNLOOP_ALLOW_MCP_GATEWAY: "false",
    FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS: "false",
    ...extra,
  });
}

function view(extra: Record<string, unknown> = {}) {
  return {
    id: "npol_memory_test",
    update_time_ms: 9,
    egress: {
      allow_all: false,
      allow_devbox_to_devbox: false,
      allow_agent_gateway: false,
      allow_mcp_gateway: false,
      allow_runloop_mirrors: false,
      allowed_hostnames: [],
      allowed_cidrs: [],
      ...extra,
    },
  };
}

describe("RunloopProvider paid network lifecycle", () => {
  it("records the attachment and does not resume a legacy devbox", async () => {
    const network = configEnv();
    const plane = new MemoryRunloopControlPlane();
    plane.setNetworkPolicy(network.policyId, view());
    const provider = new RunloopProvider({
      client: plane,
      blueprint: "memory",
      requireInteractive: false,
      requirePaidNetworkPolicy: true,
      network,
    });
    const created = await provider.provision({ birdId: "bird-mem", flockId: "flock-mem" });
    assert.equal(created.networkAttachment?.effectivePolicyId, network.policyId);
    assert.equal(created.networkAttachment?.enforcement, "eventually-consistent");
    const decision = evaluateVendorNetworkPolicy(network, view(), "2026-10-03T18:00:00.000Z", true);
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(created.networkAttachment?.contentHash, decision.attachment.contentHash);

    plane.setAttachedPolicy(created.providerRef, null);
    await provider.pause(created.providerRef);
    await assert.rejects(
      () => provider.wake(created.providerRef),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_LEGACY",
    );
    assert.equal(plane.resumeCount(created.providerRef), 0);
  });

  it("refuses wake when the attached policy drifts to allow_all", async () => {
    const network = configEnv();
    const plane = new MemoryRunloopControlPlane();
    plane.setNetworkPolicy(network.policyId, view());
    const provider = new RunloopProvider({
      client: plane,
      blueprint: "memory",
      requireInteractive: false,
      requirePaidNetworkPolicy: true,
      network,
    });
    const created = await provider.provision({ birdId: "bird-drift", flockId: "flock-mem" });
    plane.setNetworkPolicy(network.policyId, view({ allow_all: true }));
    await provider.pause(created.providerRef);
    await assert.rejects(
      () => provider.wake(created.providerRef),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_UNSAFE",
    );
    assert.equal(plane.resumeCount(created.providerRef), 0);
  });

  it("does not keep a devbox whose policy is allow_all", async () => {
    const network = configEnv();
    const plane = new MemoryRunloopControlPlane();
    plane.setNetworkPolicy(network.policyId, view({ allow_all: true }));
    const provider = new RunloopProvider({
      client: plane,
      blueprint: "memory",
      requireInteractive: false,
      requirePaidNetworkPolicy: true,
      network,
    });
    await assert.rejects(
      () => provider.provision({ birdId: "bird-open", flockId: "flock-mem" }),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_UNSAFE",
    );
    assert.equal(plane.resumeCount(plane.lastCreatedId ?? ""), 0);
  });

  it("redacts provider secret values and refuses to write them into the guest", async () => {
    const previous = process.env.RUNLOOP_API_KEY;
    process.env.RUNLOOP_API_KEY = "control-plane-secret-value";
    try {
      assert.equal(redactControlPlaneSecrets("see control-plane-secret-value now"), "see [redacted] now");
      const provider = new RunloopProvider({
        client: new MemoryRunloopControlPlane(),
        blueprint: "memory",
        requireInteractive: false,
      });
      const created = await provider.provision({ birdId: "bird-secret", flockId: "flock-mem" });
      const wrote = await provider.filesystem(created.providerRef, {
        operation: "write",
        path: "/home/user/flok/note.txt",
        content: "control-plane-secret-value",
      });
      assert.equal(wrote.ok, false);
      if (!wrote.ok) assert.equal(wrote.errorCode, "SECRET_REJECTED");
    } finally {
      if (previous === undefined) delete process.env.RUNLOOP_API_KEY;
      else process.env.RUNLOOP_API_KEY = previous;
    }
  });
});
