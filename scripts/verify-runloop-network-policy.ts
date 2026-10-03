/**
 * Owner-run deny/allow probe for a paid Runloop network policy.
 *
 * This file does not call Runloop unless FLOK_LIVE_NETWORK_POLICY_VERIFY=1.
 * It does not create a devbox unless FLOK_LIVE_NETWORK_POLICY_CREATE=1 as well.
 * Do not treat a successful control-plane read as dataplane enforcement.
 * Vendor policy changes are eventually consistent and are not an instant revoke.
 *
 * Unresolved probes (redirects, DNS/IP bypass, cross-devbox, propagation) are
 * printed as gaps. They are not passes.
 */

import { RunloopSDK } from "@runloop/api-client";
import {
  ComputerService,
  RunloopProvider,
  capabilityAuth,
} from "../src/lib/computers/index.js";
import {
  RUNLOOP_CONTROL_PLANE_ORIGIN,
  createRunloopControlPlaneFetch,
  evaluateVendorNetworkPolicy,
  liveProbePlan,
  parsePaidNetworkPolicyConfig,
} from "../src/lib/computers/network-policy.js";

const VERIFY_FLAG = "FLOK_LIVE_NETWORK_POLICY_VERIFY";
const CREATE_FLAG = "FLOK_LIVE_NETWORK_POLICY_CREATE";

const PYTHON_FETCH = [
  "import sys, urllib.request",
  "url = sys.argv[1]",
  "try:",
  "    urllib.request.urlopen(url, timeout=8)",
  "except Exception:",
  "    sys.exit(1)",
].join("\n");

const PYTHON_SECRET = [
  "import os, sys",
  "keys = ['RUNLOOP_API_KEY','RUNLOOP_BEARER_TOKEN','GITHUB_TOKEN','GH_TOKEN','GITHUB_PAT']",
  "sys.exit(1 if any(os.environ.get(key) for key in keys) else 0)",
].join("\n");

function refuse(): never {
  process.stderr.write(
    `refusing live network probe: set ${VERIFY_FLAG}=1 for a read-only policy read. ` +
      `Creating a devbox also requires ${CREATE_FLAG}=1. This process did not call Runloop.\n`,
  );
  process.exit(2);
}

async function readPolicy(): Promise<{ view: unknown; config: ReturnType<typeof parsePaidNetworkPolicyConfig> }> {
  const config = parsePaidNetworkPolicyConfig();
  const sdk = new RunloopSDK({
    bearerToken: process.env.RUNLOOP_API_KEY,
    baseURL: RUNLOOP_CONTROL_PLANE_ORIGIN,
    fetch: createRunloopControlPlaneFetch() as unknown as NonNullable<
      ConstructorParameters<typeof RunloopSDK>[0]
    >["fetch"],
  });
  const view = await sdk.networkPolicy.fromId(config.policyId).getInfo();
  return { view, config };
}

async function main(): Promise<void> {
  if (process.env[VERIFY_FLAG] !== "1") refuse();
  const { view, config } = await readPolicy();
  const decision = evaluateVendorNetworkPolicy(config, view, new Date().toISOString(), true);
  if (!decision.ok) {
    process.stderr.write(`policy rejected: ${decision.code}\n`);
    process.exit(1);
  }
  const attachment = decision.attachment;
  const hostnames =
    view && typeof view === "object" && "egress" in view
      ? ((view as { egress?: { allowed_hostnames?: string[] } }).egress?.allowed_hostnames ?? [])
      : [];
  const plan = liveProbePlan(config, hostnames);
  process.stdout.write(
    `${JSON.stringify({
      profile: attachment.profile,
      revisionMs: attachment.revisionMs,
      contentHash: attachment.contentHash,
      enforcement: attachment.enforcement,
      allowAll: attachment.allowAll,
      allowDevboxToDevbox: attachment.allowDevboxToDevbox,
      hostnameCount: hostnames.length,
      note: "Control-plane acceptance is not dataplane enforcement. Vendor updates are eventually consistent.",
    })}\n`,
  );
  if (process.env[CREATE_FLAG] !== "1") {
    process.stdout.write(
      `read-only policy check finished. Set ${CREATE_FLAG}=1 to create one paid devbox and run deny/allow probes. No devbox was created.\n`,
    );
    for (const probe of plan) {
      if (probe.expect === "unresolved") process.stdout.write(`UNRESOLVED ${probe.id}: ${probe.reason}\n`);
    }
    return;
  }

  const provider = await RunloopProvider.fromEnv();
  const service = new ComputerService(provider);
  const birdId = `netprobe-${Date.now().toString(36)}`;
  const flockId = "flock-netprobe";
  const computer = await service.requestComputer({ birdId, flockId });
  const providerRef = computer.providerRef;
  if (!providerRef) throw new Error("probe computer has no provider ref");
  let failed = 0;
  try {
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, { birdId, flockId });
    const auth = capabilityAuth(paired.token);
    for (const probe of plan) {
      if (probe.expect === "unresolved" || probe.host === null && probe.expect !== "secret-absent") {
        process.stdout.write(`UNRESOLVED ${probe.id}: ${probe.reason}\n`);
        continue;
      }
      const argv =
        probe.expect === "secret-absent"
          ? ["python3", "-c", PYTHON_SECRET]
          : ["python3", "-c", PYTHON_FETCH, `https://${probe.host}/`];
      const result = await service.exec(auth, computer.id, { argv, timeoutMs: 20_000 });
      const denied = result.exitCode !== 0 || result.timedOut;
      const passed =
        (probe.expect === "secret-absent" && result.exitCode === 0 && !result.timedOut) ||
        (probe.expect === "deny" && denied) ||
        (probe.expect === "allow" && result.exitCode === 0 && !result.timedOut);
      if (!passed) failed += 1;
      process.stdout.write(
        `${passed ? "PASS" : "FAIL"} ${probe.id} expect=${probe.expect} exit=${result.exitCode} timedOut=${result.timedOut}\n`,
      );
      if (result.stdout.includes("RUNLOOP_API_KEY") || result.stderr.includes("RUNLOOP_API_KEY")) {
        failed += 1;
        process.stdout.write(`FAIL ${probe.id} secret leaked in output\n`);
      }
    }
  } finally {
    await service.destroyThisComputer(computer.id, { confirm: true, providerRef }).catch(() => {
      process.stderr.write("destroy failed\n");
      failed += 1;
    });
  }
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "probe failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
