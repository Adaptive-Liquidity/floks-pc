/**
 * Owner live-screen path on ComputerService.
 * FakeProvider is unpaid protocol coverage, not Agent Computer proof.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerAsleep,
  ComputerError,
  ComputerNotFound,
  ComputerService,
  FakeProvider,
  MemoryControlPlaneStore,
  ObserveRetryable,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";

class SlowObserveProvider extends FakeProvider {
  async observe(ref: string, request: { includeScreenshot?: boolean }): Promise<{
    screenWidth: number;
    screenHeight: number;
    screenshotBase64?: string;
  }> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });
    return super.observe(ref, request);
  }
}

describe("owner desktop service", () => {
  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
    assert.equal(
      MCP_TOOL_NAMES.join(","),
      "computer_pair,computer_status,computer_exec,computer_fs,computer_observe,computer_act,handoff_send,handoff_receive",
    );
  });

  it("returns a screenshot on a ready computer and does not persist it", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-view", flockId: "flock-view" });
    const watched = await service.ownerDesktopWatch(computer.id);
    assert.equal(watched.ok, true);
    if (!watched.ok) return;
    assert.equal(watched.screen.hasScreenshot, true);
    assert.equal(typeof watched.screen.screenshotBase64, "string");
    const events = JSON.stringify(service.listOperatorEvents());
    assert.doesNotMatch(events, /screenshot/i);
    assert.doesNotMatch(events, /iVBORw0KGgo/);
  });

  it("offers wake instead of erroring when the computer is paused", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-sleep", flockId: "flock-sleep" });
    await service.pauseThisComputer(computer.id);
    const status = await service.ownerDesktopStatus(computer.id);
    assert.equal(status.needsWake, true);
    assert.equal(status.viewable, false);
    const watched = await service.ownerDesktopWatch(computer.id);
    assert.equal(watched.ok, false);
    if (watched.ok) return;
    assert.equal(watched.needsWake, true);
    assert.equal(watched.state, "paused");
    await assert.rejects(() => service.ownerDesktopAct(computer.id, {
      actions: [{ type: "click_coordinates", x: 10, y: 10 }],
    }), ObserveRetryable);
  });

  it("wakes a paused computer with the existing wake path", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-wake", flockId: "flock-wake" });
    await service.pauseThisComputer(computer.id);
    const woken = await service.wakeThisComputer(computer.id);
    assert.equal(woken.state === "ready" || woken.state === "running", true);
    const watched = await service.ownerDesktopWatch(computer.id);
    assert.equal(watched.ok, true);
  });

  it("records view and takeover start/stop without secrets", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-log", flockId: "flock-log" });
    service.noteOwnerDesktop({ computerId: computer.id, operation: "owner-view-start", success: true });
    service.noteOwnerDesktop({ computerId: computer.id, operation: "owner-takeover-start", success: true });
    service.noteOwnerDesktop({ computerId: computer.id, operation: "owner-takeover-stop", success: true });
    service.noteOwnerDesktop({ computerId: computer.id, operation: "owner-view-stop", success: true });
    const ops = service.listOperatorEvents().map((e) => e.operation);
    assert.deepEqual(
      ops.filter((op) => op.startsWith("owner-")),
      ["owner-view-start", "owner-takeover-start", "owner-takeover-stop", "owner-view-stop"],
    );
    const blob = JSON.stringify(service.listOperatorEvents());
    assert.doesNotMatch(blob, /token|password|runloop\.ai|6080/i);
  });

  it("allows coordinate and key input and rejects open_url", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-act", flockId: "flock-act" });
    const ok = await service.ownerDesktopAct(computer.id, {
      actions: [
        { type: "click_coordinates", x: 12, y: 40 },
        { type: "type", text: "hi" },
        { type: "key", key: "Return" },
        { type: "scroll", y: 3 },
      ],
    });
    assert.equal(ok.ok, true);
    await assert.rejects(
      () => service.ownerDesktopAct(computer.id, { actions: [{ type: "open_url", url: "https://example.com" }] }),
      (err: unknown) => err instanceof ComputerError && err.code === "OWNER_ACT_DENIED",
    );
    await assert.rejects(
      () => service.ownerDesktopAct(computer.id, { actions: [{ type: "click_element", elementId: "x" }] }),
      (err: unknown) => err instanceof ComputerError && err.code === "OWNER_ACT_DENIED",
    );
  });

  it("times out a hung observe", async () => {
    const service = new ComputerService(new SlowObserveProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-slow", flockId: "flock-slow" });
    await assert.rejects(
      () => service.ownerDesktopWatch(computer.id, { timeoutMs: 15 }),
      (err: unknown) => err instanceof ComputerError && err.code === "OWNER_DESKTOP_TIMEOUT",
    );
  });

  it("fails closed when the computer is missing", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    await assert.rejects(() => service.ownerDesktopStatus("missing"), ComputerNotFound);
  });

  it("reloads shared state before owner screen reads or acts", async () => {
    const store = new MemoryControlPlaneStore();
    const a = new ComputerService(new FakeProvider(), { store });
    const computer = await a.requestComputer({ birdId: "bird-share", flockId: "flock-share" });
    const b = new ComputerService(new FakeProvider(), { store });
    await b.hydrate();
    assert.equal((await b.ownerDesktopStatus(computer.id)).needsWake, false);
    await a.pauseThisComputer(computer.id);
    const status = await b.ownerDesktopStatus(computer.id);
    assert.equal(status.needsWake, true);
    assert.equal(status.computer.state, "paused");
    const watched = await b.ownerDesktopWatch(computer.id);
    assert.equal(watched.ok, false);
    if (!watched.ok) assert.equal(watched.needsWake, true);
    await assert.rejects(
      () => b.ownerDesktopAct(computer.id, { actions: [{ type: "click_coordinates", x: 4, y: 4 }] }),
      ObserveRetryable,
    );
  });

  it("refuses wake and recover when the seat is not admitted", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    service.setWakeAdmission(async () => false);
    const computer = await service.requestComputer({ birdId: "bird-bill", flockId: "flock-bill" });
    await service.pauseThisComputer(computer.id);
    await assert.rejects(() => service.wakeThisComputer(computer.id), ComputerAsleep);
    await assert.rejects(() => service.recoverThisComputer(computer.id), ComputerAsleep);
    assert.equal((await service.get(computer.id)).state, "paused");
  });

  it("serializes concurrent wakes on a paused computer", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    const computer = await service.requestComputer({ birdId: "bird-race", flockId: "flock-race" });
    await service.pauseThisComputer(computer.id);
    const [a, b] = await Promise.all([
      service.wakeThisComputer(computer.id),
      service.wakeThisComputer(computer.id),
    ]);
    assert.equal(a.state === "ready" || a.state === "running", true);
    assert.equal(b.state === "ready" || b.state === "running", true);
  });
});
