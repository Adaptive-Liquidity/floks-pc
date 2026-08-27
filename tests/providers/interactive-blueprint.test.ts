import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RUNLOOP_BLUEPRINT } from "../../src/lib/computers/providers/runloop-client.js";
import {
  InteractiveBlueprintRequired,
  allowComputeOnlyBlueprint,
  buildAgentComputerLabels,
  isGenericComputeBlueprint,
  resolveAgentComputerBlueprint,
} from "../../src/lib/computers/providers/interactive-blueprint.js";
import {
  MemoryRunloopControlPlane,
  RunloopProvider,
} from "../../src/lib/computers/providers/runloop.js";

describe("L1 interactive blueprint fail-closed", () => {
  it("rejects generic compute-only DnD as an Agent Computer", () => {
    assert.equal(isGenericComputeBlueprint(DEFAULT_RUNLOOP_BLUEPRINT), true);
    assert.throws(
      () =>
        resolveAgentComputerBlueprint({
          FLOK_RUNLOOP_BLUEPRINT: DEFAULT_RUNLOOP_BLUEPRINT,
        }),
      (err: unknown) =>
        err instanceof InteractiveBlueprintRequired &&
        err.code === "INTERACTIVE_BLUEPRINT_REQUIRED",
    );
  });

  it("rejects missing blueprint instead of falling back to DnD", () => {
    assert.throws(
      () => resolveAgentComputerBlueprint({}),
      (err: unknown) => err instanceof InteractiveBlueprintRequired,
    );
  });

  it("accepts flok-runloop-interactive", () => {
    assert.equal(
      resolveAgentComputerBlueprint({
        FLOK_RUNLOOP_BLUEPRINT: "flok-runloop-interactive",
      }),
      "flok-runloop-interactive",
    );
  });

  it("accepts owner-validated interactive alias", () => {
    assert.equal(
      resolveAgentComputerBlueprint({
        FLOK_RUNLOOP_BLUEPRINT: "my-flok-ui-image",
        FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT: "my-flok-ui-image",
      }),
      "my-flok-ui-image",
    );
  });

  it("tags FLOKS Devboxes so cleanup can target this run only", () => {
    const labels = buildAgentComputerLabels(
      { birdId: "bird-local", flockId: "flock-local" },
      { ownerId: "op", workspaceId: "ws", runId: "run-1" },
    );
    assert.equal(labels.floks_run_id, "run-1");
    assert.equal(labels.workspace, "ws");
    assert.equal(labels.user, "op");
    assert.equal(labels.bird_id, "bird-local");
    assert.equal(labels.flock_id, "flock-local");
    assert.equal(labels.purpose, "agent-computer");
  });

  it("compute-only opt-in is explicit and off by default", () => {
    assert.equal(allowComputeOnlyBlueprint({}), false);
    assert.equal(
      resolveAgentComputerBlueprint({
        FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY: "1",
      }),
      DEFAULT_RUNLOOP_BLUEPRINT,
    );
  });

  it("re-pauses a paid session when wake interactive validation fails", async () => {
    const plane = new MemoryRunloopControlPlane();
    const provider = new RunloopProvider({
      client: plane,
      blueprint: "flok-runloop-interactive",
      requireInteractive: true,
    });
    const computer = await provider.provision({ birdId: "bird-wake", flockId: "flock-wake" });
    await provider.pause(computer.providerRef);
    const session = await plane.get(computer.providerRef);
    session.interactiveGuest = false;
    await assert.rejects(
      () => provider.wake(computer.providerRef),
      (err: unknown) => err instanceof InteractiveBlueprintRequired,
    );
    assert.equal(await session.state(), "paused");
  });
});
