import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIVE_KEEP_ALIVE_SECONDS,
  parseRunloopOnIdle,
  runloopLaunchParameters,
  type RunloopCreateParams,
} from "../../src/lib/computers/providers/runloop-client.ts";
import { suspendIdleTimeSeconds } from "../../src/lib/computers/providers/runloop.ts";
import { createSdkRunloopPlane } from "../../src/lib/computers/providers/runloop-sdk.ts";

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

function stubSdk() {
  const bodies: Array<Record<string, unknown>> = [];
  const box = {
    id: "devbox-stub",
    getInfo: async () => ({ status: "running", metadata: {} }),
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
    suspend: async () => undefined,
    awaitSuspended: async () => undefined,
    resume: async () => undefined,
    awaitRunning: async () => undefined,
    shutdown: async () => undefined,
    keepAlive: async () => undefined,
    snapshotDisk: async () => ({ id: "snap" }),
  };
  return {
    bodies,
    sdk: {
      devbox: {
        createFromBlueprintName: async (_blueprint: string, body: Record<string, unknown>) => {
          bodies.push(body);
          return box;
        },
        createFromSnapshot: async (_ref: string, body: Record<string, unknown>) => {
          bodies.push(body);
          return box;
        },
        fromId: () => box,
      },
    },
  };
}

async function planeFor(env: NodeJS.ProcessEnv) {
  const { bodies, sdk } = stubSdk();
  const plane = await createSdkRunloopPlane({
    apiKey: "not-sent",
    blueprint: "bp",
    keepAliveSeconds: LIVE_KEEP_ALIVE_SECONDS,
    sdk,
    env,
  });
  return { bodies, plane };
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
        assert.equal("lifecycle" in launch, false);
      }
    }
    const suspended = await planeFor({ FLOK_RUNLOOP_ON_IDLE: "suspend" });
    await suspended.plane.create({ ...PARAMS, idleTimeSeconds: suspendIdleTimeSeconds({}) });
    await suspended.plane.restore("snap-idle", {
      ...PARAMS,
      idleTimeSeconds: suspendIdleTimeSeconds({ STAXIONS_IDLE_MINUTES: "45" }),
    });
    const first = suspended.bodies[0]?.launch_parameters as {
      lifecycle: { after_idle: { idle_time_seconds: number } };
    };
    const second = suspended.bodies[1]?.launch_parameters as {
      lifecycle: { after_idle: { idle_time_seconds: number } };
    };
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
    );
    assert.equal("keep_alive_time_seconds" in keep && keep.keep_alive_time_seconds, 900);
  });
});
