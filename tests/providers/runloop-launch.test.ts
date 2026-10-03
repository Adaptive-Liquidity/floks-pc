import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NetworkPolicyRejected } from "../../src/lib/computers/errors.ts";
import {
  LIVE_KEEP_ALIVE_SECONDS,
  parseRunloopOnIdle,
  runloopLaunchParameters,
  type RunloopCreateParams,
} from "../../src/lib/computers/providers/runloop-client.ts";
import { suspendIdleTimeSeconds } from "../../src/lib/computers/providers/runloop.ts";
import { createSdkRunloopPlane } from "../../src/lib/computers/providers/runloop-sdk.ts";
import type { PaidNetworkPolicyConfig } from "../../src/lib/computers/network-policy.ts";

const POLICY_ID = "npol_test_restrictive";

const NETWORK: PaidNetworkPolicyConfig = {
  policyId: POLICY_ID,
  profile: "governed-github",
  allowAgentGateway: false,
  allowMcpGateway: false,
  allowRunloopMirrors: false,
  packagePreset: null,
  controlPlaneHosts: [],
};

function vendorPolicy(egress: Record<string, unknown> = {}) {
  return {
    id: POLICY_ID,
    update_time_ms: 1_700_000_000_000,
    egress: {
      allow_all: false,
      allow_devbox_to_devbox: false,
      allow_agent_gateway: false,
      allow_mcp_gateway: false,
      allow_runloop_mirrors: false,
      allowed_hostnames: [] as string[],
      allowed_cidrs: [] as Array<{ cidr: string }>,
      ...egress,
    },
  };
}

const PARAMS: RunloopCreateParams = {
  birdId: "bird-launch",
  flockId: "flock-launch",
  blueprint: "bp",
  architecture: "x86_64",
  keepAliveSeconds: 3600,
  idleTimeSeconds: 900,
  labels: { bird_id: "bird-launch" },
  envVars: {},
};

function stubSdk(opts?: { policy?: ReturnType<typeof vendorPolicy>; echoPolicy?: boolean }) {
  const bodies: Array<Record<string, unknown>> = [];
  const resumeArgs: unknown[][] = [];
  const shutdowns: string[] = [];
  const suspends: string[] = [];
  let launch: Record<string, unknown> | null = null;
  const echoPolicy = opts?.echoPolicy !== false;
  const policy = opts?.policy ?? vendorPolicy();
  const box = {
    id: "devbox-stub",
    getInfo: async () => ({
      status: "running",
      metadata: {},
      launch_parameters: echoPolicy ? launch : { architecture: "x86_64" },
    }),
    cmd: {
      exec: async () => ({
        exitCode: 0,
        stdout: async () => "boot\n",
        stderr: async () => "",
      }),
    },
    file: {
      read: async () => "",
      write: async () => undefined,
      download: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      upload: async () => undefined,
    },
    suspend: async () => {
      suspends.push("suspend");
    },
    awaitSuspended: async () => undefined,
    resume: async (...args: unknown[]) => {
      resumeArgs.push(args);
    },
    awaitRunning: async () => undefined,
    shutdown: async () => {
      shutdowns.push("shutdown");
    },
    keepAlive: async () => undefined,
    snapshotDisk: async () => ({ id: "snap" }),
  };
  return {
    bodies,
    resumeArgs,
    shutdowns,
    suspends,
    sdk: {
      devbox: {
        createFromBlueprintName: async (_blueprint: string, body: Record<string, unknown>) => {
          bodies.push(body);
          launch = body.launch_parameters as Record<string, unknown>;
          return box;
        },
        createFromSnapshot: async (_ref: string, body: Record<string, unknown>) => {
          bodies.push(body);
          launch = body.launch_parameters as Record<string, unknown>;
          return box;
        },
        fromId: () => box,
      },
      networkPolicy: {
        fromId: () => ({
          getInfo: async () => policy,
        }),
      },
    },
  };
}

async function planeFor(
  env: NodeJS.ProcessEnv,
  sdkOpts?: { policy?: ReturnType<typeof vendorPolicy>; echoPolicy?: boolean },
) {
  const stub = stubSdk(sdkOpts);
  const plane = await createSdkRunloopPlane({
    apiKey: "not-sent",
    blueprint: "bp",
    keepAliveSeconds: LIVE_KEEP_ALIVE_SECONDS,
    network: NETWORK,
    sdk: stub.sdk,
    env,
  });
  return { ...stub, plane };
}

describe("runloop launch parameters", () => {
  it("keeps keep-alive unless FLOK_RUNLOOP_ON_IDLE is exactly suspend", async () => {
    for (const value of [undefined, ""] as const) {
      const env: NodeJS.ProcessEnv = {};
      if (value !== undefined) env.FLOK_RUNLOOP_ON_IDLE = value;
      const { bodies, plane } = await planeFor(env);
      await plane.create(PARAMS);
      await plane.restore("snap-keep", PARAMS);
      for (const body of bodies) {
        const launch = body.launch_parameters as Record<string, unknown>;
        assert.equal(launch.keep_alive_time_seconds, 3600);
        assert.equal(launch.network_policy_id, POLICY_ID);
        assert.equal("lifecycle" in launch, false);
        assert.equal(body.secrets, undefined);
        assert.equal(body.gateways, undefined);
        assert.equal(body.mcp, undefined);
        assert.equal(body.tunnel, undefined);
      }
    }
    const suspended = await planeFor({ FLOK_RUNLOOP_ON_IDLE: "suspend" });
    await suspended.plane.create({ ...PARAMS, idleTimeSeconds: suspendIdleTimeSeconds({}) });
    await suspended.plane.restore("snap-idle", {
      ...PARAMS,
      idleTimeSeconds: suspendIdleTimeSeconds({ STAXIONS_IDLE_MINUTES: "45" }),
    });
    const first = suspended.bodies[0]?.launch_parameters as {
      network_policy_id: string;
      lifecycle: { after_idle: { idle_time_seconds: number } };
    };
    const second = suspended.bodies[1]?.launch_parameters as {
      lifecycle: { after_idle: { idle_time_seconds: number } };
    };
    assert.equal(first.network_policy_id, POLICY_ID);
    assert.equal(first.lifecycle.after_idle.idle_time_seconds, 1800);
    assert.equal(second.lifecycle.after_idle.idle_time_seconds, 2700);
    assert.equal("keep_alive_time_seconds" in (suspended.bodies[0]?.launch_parameters as object), false);
  });

  it("rejects any FLOK_RUNLOOP_ON_IDLE value other than suspend", async () => {
    for (const value of ["Suspend", "shutdown"]) {
      await assert.rejects(
        () =>
          createSdkRunloopPlane({
            apiKey: "not-sent",
            blueprint: "bp",
            network: NETWORK,
            sdk: stubSdk().sdk,
            env: { FLOK_RUNLOOP_ON_IDLE: value },
          }),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : "";
          assert.match(message, /FLOK_RUNLOOP_ON_IDLE/);
          assert.match(message, /suspend/);
          assert.equal(message.includes(value), false);
          return true;
        },
      );
    }
    assert.equal(parseRunloopOnIdle({}), undefined);
    assert.equal(parseRunloopOnIdle({ FLOK_RUNLOOP_ON_IDLE: "" }), undefined);
    const keep = runloopLaunchParameters(
      { ...PARAMS, keepAliveSeconds: LIVE_KEEP_ALIVE_SECONDS },
      LIVE_KEEP_ALIVE_SECONDS,
      undefined,
      POLICY_ID,
    );
    assert.equal("keep_alive_time_seconds" in keep && keep.keep_alive_time_seconds, 900);
    assert.equal(keep.network_policy_id, POLICY_ID);
    assert.throws(() =>
      runloopLaunchParameters(
        { ...PARAMS, keepAliveSeconds: LIVE_KEEP_ALIVE_SECONDS },
        LIVE_KEEP_ALIVE_SECONDS,
        undefined,
        "  ",
      ),
    );
  });

  it("logs runloop.launch mode for create and restore without secrets or policy ids", async () => {
    const lines: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const keep = await planeFor({});
      await keep.plane.create(PARAMS);
      await keep.plane.restore("snap-log", PARAMS);
      const suspended = await planeFor({ FLOK_RUNLOOP_ON_IDLE: "suspend" });
      await suspended.plane.create({ ...PARAMS, idleTimeSeconds: 1800 });
      await suspended.plane.restore("snap-log-suspend", { ...PARAMS, idleTimeSeconds: 2700 });
    } finally {
      process.stderr.write = original;
    }
    const launch = lines.filter((line) => line.startsWith("runloop.launch "));
    assert.deepEqual(
      launch.map((line) => line.trim()),
      [
        'runloop.launch {"op":"create","mode":"keep_alive","keep_alive_s":3600,"policy_attached":true,"enforcement":"eventually-consistent"}',
        'runloop.launch {"op":"restore","mode":"keep_alive","keep_alive_s":3600,"policy_attached":true,"enforcement":"eventually-consistent"}',
        'runloop.launch {"op":"create","mode":"suspend","idle_s":1800,"policy_attached":true,"enforcement":"eventually-consistent"}',
        'runloop.launch {"op":"restore","mode":"suspend","idle_s":2700,"policy_attached":true,"enforcement":"eventually-consistent"}',
      ],
    );
    const text = launch.join("\n");
    assert.equal(text.includes("not-sent"), false);
    assert.equal(text.includes("bird-launch"), false);
    assert.equal(text.includes("devbox"), false);
    assert.equal(text.includes(POLICY_ID), false);
  });

  it("refuses allow_all and does not create a devbox", async () => {
    const { bodies, plane } = await planeFor({}, { policy: vendorPolicy({ allow_all: true }) });
    await assert.rejects(
      () => plane.create(PARAMS),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_UNSAFE",
    );
    assert.equal(bodies.length, 0);
  });

  it("shuts down when launch parameters do not echo the policy id", async () => {
    const { bodies, shutdowns, plane } = await planeFor({}, { echoPolicy: false });
    await assert.rejects(
      () => plane.create(PARAMS),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_UNATTACHED",
    );
    assert.equal(bodies.length, 1);
    assert.equal(shutdowns.length, 1);
  });

  it("resume takes no policy argument and refuses a legacy devbox", async () => {
    const ready = await planeFor({});
    const session = await ready.plane.create(PARAMS);
    await session.resume();
    assert.deepEqual(ready.resumeArgs, [[]]);

    const legacy = await planeFor({}, { echoPolicy: false });
    const created = legacy.sdk.devbox.fromId("devbox-stub");
    const legacySession = await legacy.plane.get("devbox-stub");
    await assert.rejects(
      () => legacySession.resume(),
      (err: unknown) => err instanceof NetworkPolicyRejected && err.code === "NETWORK_POLICY_LEGACY",
    );
    assert.equal(legacy.resumeArgs.length, 0);
    assert.equal(legacy.suspends.length, 2);
    assert.equal(created.id, "devbox-stub");
  });
});
