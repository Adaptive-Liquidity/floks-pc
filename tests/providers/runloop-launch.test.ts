import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSdkRunloopPlane } from "../../src/lib/computers/providers/runloop-sdk.ts";
import type { RunloopCreateParams } from "../../src/lib/computers/providers/runloop-client.ts";

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

describe("runloop launch parameters", () => {
  it("suspends on idle only when FLOK_RUNLOOP_ON_IDLE is suspend", async () => {
    const previous = process.env.FLOK_RUNLOOP_ON_IDLE;
    const { bodies, sdk } = stubSdk();
    const plane = await createSdkRunloopPlane({
      apiKey: "not-sent",
      blueprint: "bp",
      keepAliveSeconds: 3600,
      sdk,
    });
    try {
      process.env.FLOK_RUNLOOP_ON_IDLE = "suspend";
      await plane.create(PARAMS);
      await plane.restore("snap-1", PARAMS);
      for (const body of bodies) {
        const launch = body.launch_parameters as Record<string, unknown>;
        assert.equal("keep_alive_time_seconds" in launch, false);
        assert.deepEqual(launch.lifecycle, {
          after_idle: { idle_time_seconds: 900, on_idle: "suspend" },
        });
      }
      bodies.length = 0;
      delete process.env.FLOK_RUNLOOP_ON_IDLE;
      await plane.create(PARAMS);
      await plane.restore("snap-2", PARAMS);
      for (const body of bodies) {
        const launch = body.launch_parameters as Record<string, unknown>;
        assert.equal(launch.keep_alive_time_seconds, 3600);
        assert.equal("lifecycle" in launch, false);
      }
    } finally {
      if (previous === undefined) delete process.env.FLOK_RUNLOOP_ON_IDLE;
      else process.env.FLOK_RUNLOOP_ON_IDLE = previous;
    }
  });
});
