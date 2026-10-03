import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { NetworkPolicyRejected } from "../../src/lib/computers/errors.ts";
import {
  GITHUB_BYPASS_HOSTS,
  NETWORK_PATH_INVENTORY,
  assertRunloopControlPlaneUrl,
  createRunloopControlPlaneFetch,
  evaluateVendorNetworkPolicy,
  isPaidNetworkPolicyConfigured,
  liveProbePlan,
  parsePaidNetworkPolicyConfig,
  type PaidNetworkPolicyConfig,
} from "../../src/lib/computers/network-policy.ts";

const OBSERVED = "2026-10-03T18:00:00.000Z";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    FLOK_RUNLOOP_NETWORK_POLICY_ID: "npol_governed_test",
    FLOK_RUNLOOP_NETWORK_PROFILE: "governed-github",
    FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY: "false",
    FLOK_RUNLOOP_ALLOW_MCP_GATEWAY: "false",
    FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS: "false",
    ...extra,
  };
}

function vendor(hostnames: string[] = [], extra: Record<string, unknown> = {}) {
  return {
    id: "npol_governed_test",
    update_time_ms: 42,
    egress: {
      allow_all: false,
      allow_devbox_to_devbox: false,
      allow_agent_gateway: false,
      allow_mcp_gateway: false,
      allow_runloop_mirrors: false,
      allowed_hostnames: hostnames,
      allowed_cidrs: [],
      ...extra,
    },
  };
}

describe("paid network policy configuration", () => {
  it("fails closed when the policy id or explicit toggles are missing", () => {
    assert.equal(isPaidNetworkPolicyConfigured({}), false);
    assert.throws(
      () => parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY: "" })),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_REQUIRED",
    );
  });

  it("rejects generic credential brokers and mirror defaults", () => {
    assert.throws(
      () => parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY: "true" })),
      (err: unknown) => err instanceof NetworkPolicyRejected && /credential proxies/.test(err.message),
    );
    assert.throws(
      () => parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS: "true" })),
      (err: unknown) => err instanceof NetworkPolicyRejected && /package preset/.test(err.message),
    );
    const config = parsePaidNetworkPolicyConfig(
      env({
        FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS: "true",
        FLOK_RUNLOOP_PACKAGE_PRESET: "npm",
      }),
    );
    assert.equal(config.allowRunloopMirrors, true);
    assert.equal(config.packagePreset, "npm");
    assert.equal(config.allowAgentGateway, false);
  });

  it("accepts a deny-all governed policy and records hash, revision, and eventual consistency", () => {
    const config = parsePaidNetworkPolicyConfig(env());
    const decision = evaluateVendorNetworkPolicy(config, vendor(), OBSERVED, true);
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.attachment.allowAll, false);
    assert.equal(decision.attachment.allowDevboxToDevbox, false);
    assert.equal(decision.attachment.revisionMs, 42);
    assert.match(decision.attachment.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(decision.attachment.enforcement, "eventually-consistent");
    assert.equal(decision.attachment.effectivePolicyId, config.policyId);
    const again = evaluateVendorNetworkPolicy(
      config,
      vendor(["registry.npmjs.org", "registry.npmjs.org"]),
      OBSERVED,
      true,
    );
    assert.equal(again.ok, false);
  });

  it("blocks every scoped GitHub bypass, not only api.github.com", () => {
    const config = parsePaidNetworkPolicyConfig(env());
    for (const host of GITHUB_BYPASS_HOSTS) {
      const decision = evaluateVendorNetworkPolicy(config, vendor([host]), OBSERVED, true);
      assert.equal(decision.ok, false, host);
      if (!decision.ok) assert.equal(decision.code, "NETWORK_POLICY_UNSAFE");
    }
    for (const pattern of ["*.github.com", "*.githubusercontent.com", "*", "*.ghe.com", "pages.github.io", "camo.githubusercontent.com", "evil.github.com"]) {
      const decision = evaluateVendorNetworkPolicy(config, vendor([pattern]), OBSERVED, true);
      assert.equal(decision.ok, false, pattern);
    }
    assert.throws(() =>
      parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_CONTROL_PLANE_HOSTS: "pages.github.io" })),
    );
  });

  it("treats package registries as opt-in presets", () => {
    const bare = parsePaidNetworkPolicyConfig(env());
    assert.equal(evaluateVendorNetworkPolicy(bare, vendor(["registry.npmjs.org"]), OBSERVED).ok, false);
    const npm = parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_PACKAGE_PRESET: "npm" }));
    const allowed = evaluateVendorNetworkPolicy(npm, vendor(["registry.npmjs.org"]), OBSERVED, true);
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.attachment.packagePreset, "npm");
    const mirrors = evaluateVendorNetworkPolicy(
      npm,
      vendor(["registry.npmjs.org"], { allow_runloop_mirrors: true }),
      OBSERVED,
    );
    assert.equal(mirrors.ok, false);
    const browser = parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_NETWORK_PROFILE: "public-browser" }));
    assert.equal(evaluateVendorNetworkPolicy(browser, vendor(["us.archive.ubuntu.com"]), OBSERVED).ok, false);
    assert.equal(
      evaluateVendorNetworkPolicy(browser, vendor([], { allow_unknown_egress: true }), OBSERVED).ok,
      false,
    );
  });

  it("keeps public browser weaker and still refuses unrestricted egress", () => {
    const config = parsePaidNetworkPolicyConfig(
      env({ FLOK_RUNLOOP_NETWORK_PROFILE: "public-browser" }),
    );
    assert.equal(config.profile, "public-browser");
    const github = evaluateVendorNetworkPolicy(config, vendor(["github.com", "api.github.com"]), OBSERVED, true);
    assert.equal(github.ok, true);
    if (github.ok) assert.equal(github.attachment.profile, "public-browser");
    assert.equal(evaluateVendorNetworkPolicy(config, vendor([], { allow_all: true }), OBSERVED).ok, false);
    assert.equal(
      evaluateVendorNetworkPolicy(config, vendor([], { allow_devbox_to_devbox: true }), OBSERVED).ok,
      false,
    );
    assert.equal(
      evaluateVendorNetworkPolicy(config, vendor([], { allowed_cidrs: [{ cidr: "1.2.3.0/24" }] }), OBSERVED).ok,
      false,
    );
  });

  it("refuses control-plane SSRF and redirects", async () => {
    assert.throws(() => assertRunloopControlPlaneUrl("http://api.runloop.ai"));
    assert.throws(() => assertRunloopControlPlaneUrl("https://evil.example/api.runloop.ai"));
    assert.throws(() => assertRunloopControlPlaneUrl("https://user:pass@api.runloop.ai"));
    assert.throws(() => parsePaidNetworkPolicyConfig(env({ FLOK_RUNLOOP_CONTROL_PLANE_HOSTS: "169.254.169.254" })));
    const calls: string[] = [];
    const fetchImpl = createRunloopControlPlaneFetch(async (input) => {
      calls.push(String(input));
      return new Response(null, { status: 302, headers: { location: "https://evil.example" } });
    });
    await assert.rejects(() => fetchImpl("https://api.runloop.ai/v1/network_policies"));
    await assert.rejects(() => fetchImpl("https://metadata.google.internal/"));
    assert.deepEqual(calls, ["https://api.runloop.ai/v1/network_policies"]);
  });

  it("plans deny probes for governed GitHub and does not auto-allow registries", () => {
    const config: PaidNetworkPolicyConfig = parsePaidNetworkPolicyConfig(env());
    const plan = liveProbePlan(config, []);
    for (const host of GITHUB_BYPASS_HOSTS) {
      const probe = plan.find((item) => item.host === host);
      assert.equal(probe?.expect, "deny", host);
    }
    assert.equal(plan.find((item) => item.host === "registry.npmjs.org")?.expect, "deny");
    assert.equal(plan.find((item) => item.id === "dataplane-propagation")?.expect, "unresolved");
    assert.ok(NETWORK_PATH_INVENTORY.some((item) => item.id === "agent-gateway"));
    assert.ok(NETWORK_PATH_INVENTORY.some((item) => item.id === "resume-body"));
  });

  it("the live probe script exits before calling Runloop when unauthorized", () => {
    const env = { ...process.env };
    delete env.FLOK_LIVE_NETWORK_POLICY_VERIFY;
    delete env.FLOK_LIVE_NETWORK_POLICY_CREATE;
    const result = spawnSync(
      process.execPath,
      ["--experimental-vm-modules", "node_modules/tsx/dist/cli.mjs", "scripts/verify-runloop-network-policy.ts"],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /did not call Runloop/);
    assert.equal(result.stdout.includes("PASS"), false);
  });
});
