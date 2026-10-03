import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ComputerService,
  ComputerAsleep,
  FakeProvider,
  InvalidActivityCursor,
  MemoryActivityStore,
  ProviderNeedsReplacement,
  RebuildConfirmRequired,
  ACTIVITY_RETENTION_MS,
  paginateActivityEvents,
  type ActivityEvent,
  type ActivityStore,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function pairedComputer(
  service: ComputerService,
  birdId: string,
): Promise<{ id: string; token: string; code: string }> {
  const computer = await service.requestComputer({ birdId, flockId: `flock-${birdId}` });
  const issued = await service.issuePairCode(computer.id);
  const paired = await service.pair(issued.code, { birdId, flockId: `flock-${birdId}` });
  return { id: computer.id, token: paired.token, code: issued.code };
}

function auth(token: string) {
  return { kind: "capability" as const, token };
}

class ThrowingActivityStore implements ActivityStore {
  appendCalls = 0;
  async append(): Promise<void> {
    this.appendCalls += 1;
    throw new Error("activity store down");
  }
  async list(): Promise<{ events: ActivityEvent[]; nextCursor: string | null }> {
    return { events: [], nextCursor: null };
  }
  async purgeExpired(): Promise<number> {
    throw new Error("purge down");
  }
}

describe("computer activity + owner lifecycle", () => {
  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("records observe/act/exec/fs/handoff/lifecycle without secrets or output", async () => {
    const store = new MemoryActivityStore();
    const service = new ComputerService(new FakeProvider(), { activityStore: store });
    const { id, token, code } = await pairedComputer(service, "bird-log");
    const cap = auth(token);
    await service.observe(cap, id, { includeAccessibility: false, includeScreenshot: false });
    await service.act(cap, id, { actions: [{ type: "wait", durationMs: 10 }] });
    await service.filesystem(cap, id, {
      operation: "write",
      path: "/home/flok/secret.txt",
      content: "secret-file-bytes",
    });
    await service.exec(cap, id, { argv: ["echo", "secret-stdout"] });
    service.noteHandoffAttempt({ token, operation: "handoff_send" });
    await service.pauseThisComputer(id);
    await service.wakeThisComputer(id);

    const page = await service.listActivityEvents(id, { limit: 50 });
    const operations = page.events.map((event) => event.operation);
    assert.ok(operations.includes("observe"));
    assert.ok(operations.includes("act"));
    assert.ok(operations.includes("fs:write"));
    assert.ok(operations.includes("exec"));
    assert.ok(operations.includes("handoff_send"));
    assert.ok(operations.includes("pause"));
    assert.ok(operations.includes("wake"));
    const blob = JSON.stringify(page.events);
    assert.equal(blob.includes(token), false);
    assert.equal(blob.includes(code), false);
    assert.equal(blob.includes("secret-file-bytes"), false);
    assert.equal(blob.includes("secret-stdout"), false);
    assert.doesNotMatch(blob, /"kind":"status"/);
  });

  it("paginates owner activity newest first and isolates computers", async () => {
    let now = Date.parse("2026-10-02T00:00:00.000Z");
    const store = new MemoryActivityStore();
    const service = new ComputerService(new FakeProvider(), {
      activityStore: store,
      now: () => now,
    });
    const a = await pairedComputer(service, "bird-page-a");
    const b = await pairedComputer(service, "bird-page-b");
    for (let i = 0; i < 5; i += 1) {
      now += 1_000;
      await service.exec(auth(a.token), a.id, { argv: ["echo", `a-${i}`] });
    }
    now += 1_000;
    await service.exec(auth(b.token), b.id, { argv: ["echo", "other-user-command"] });

    const first = await service.listActivityEvents(a.id, { limit: 2 });
    assert.equal(first.events.length, 2);
    assert.ok(first.nextCursor);
    const second = await service.listActivityEvents(a.id, { limit: 2, cursor: first.nextCursor });
    assert.equal(second.events.length, 2);
    assert.notEqual(first.events[0]?.id, second.events[0]?.id);
    assert.ok(first.events[0] && second.events[0] && first.events[0].at >= second.events[0].at);
    const other = await service.listActivityEvents(b.id, { limit: 20 });
    assert.equal(other.events.every((event) => event.computerId === b.id), true);
    assert.equal(
      JSON.stringify(first.events.concat(second.events)).includes("other-user-command"),
      false,
    );
    assert.equal(JSON.stringify(other.events).includes(a.token), false);
  });

  it("reads activity from the durable store, not another instance's memory", async () => {
    const shared = new MemoryActivityStore();
    const first = new ComputerService(new FakeProvider(), { activityStore: shared });
    const { id } = await pairedComputer(first, "bird-shared");
    await first.pauseThisComputer(id);
    const peer = new ComputerService(new FakeProvider(), { activityStore: shared });
    const fromStore = await peer.listActivityEvents(id, { limit: 20 });
    assert.ok(fromStore.events.some((event) => event.operation === "pause"));

    const isolated = new ComputerService(new FakeProvider(), {
      activityStore: new MemoryActivityStore(),
    });
    const empty = await isolated.listActivityEvents(id, { limit: 20 });
    assert.equal(empty.events.length, 0);
  });

  it("does not fail pause or exec when the activity store throws", async () => {
    const boom = new ThrowingActivityStore();
    const service = new ComputerService(new FakeProvider(), { activityStore: boom });
    const { id, token } = await pairedComputer(service, "bird-boom");
    await service.pauseThisComputer(id);
    assert.equal((await service.get(id)).state, "paused");
    await service.wakeThisComputer(id);
    const exec = await service.exec(auth(token), id, { argv: ["echo", "still-works"] });
    assert.equal(exec.exitCode, 0);
    assert.ok(boom.appendCalls > 0);
  });

  it("drops events older than the retention window", () => {
    const now = Date.parse("2026-10-02T00:00:00.000Z");
    const page = paginateActivityEvents(
      [
        {
          id: "old",
          at: new Date(now - ACTIVITY_RETENTION_MS - 1).toISOString(),
          computerId: "c1",
          birdId: "b1",
          kind: "exec",
          operation: "exec",
          success: true,
          errorCode: null,
        },
        {
          id: "new",
          at: new Date(now).toISOString(),
          computerId: "c1",
          birdId: "b1",
          kind: "exec",
          operation: "exec",
          success: true,
          errorCode: null,
        },
      ],
      { limit: 20, nowMs: now },
    );
    assert.deepEqual(page.events.map((event) => event.id), ["new"]);
  });

  it("pause and resume keep files; restart keeps files when wake works", async () => {
    const service = new ComputerService(new FakeProvider());
    const { id, token } = await pairedComputer(service, "bird-disk");
    const cap = auth(token);
    await service.filesystem(cap, id, {
      operation: "write",
      path: "/home/flok/keep.txt",
      content: "kept-bytes",
    });
    await service.pauseThisComputer(id);
    assert.equal((await service.get(id)).state, "paused");
    await service.wakeThisComputer(id);
    assert.equal((await service.get(id)).state, "ready");
    const afterResume = await service.filesystem(cap, id, {
      operation: "read",
      path: "/home/flok/keep.txt",
    });
    assert.equal(afterResume.ok, true);
    assert.equal(afterResume.data, "kept-bytes");

    await service.restartThisComputer(id);
    assert.equal((await service.get(id)).state, "ready");
    const afterRestart = await service.filesystem(cap, id, {
      operation: "read",
      path: "/home/flok/keep.txt",
    });
    assert.equal(afterRestart.ok, true);
    assert.equal(afterRestart.data, "kept-bytes");
  });

  it("restart warns before a rebuild that would lose files", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const { id, token } = await pairedComputer(service, "bird-rebuild");
    const cap = auth(token);
    await service.filesystem(cap, id, {
      operation: "write",
      path: "/home/flok/do-not-lose.txt",
      content: "precious",
    });
    const originalWake = provider.wake.bind(provider);
    let failWake = true;
    provider.wake = async (ref: string) => {
      if (failWake) throw new ProviderNeedsReplacement("fake");
      await originalWake(ref);
    };

    await assert.rejects(
      () => service.restartThisComputer(id),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    const still = await service.get(id);
    assert.equal(still.state, "stopped");
    assert.equal(still.rebuildConfirmRequired, true);
    failWake = false;
    await service.wakeThisComputer(id);
    const kept = await service.filesystem(cap, id, {
      operation: "read",
      path: "/home/flok/do-not-lose.txt",
    });
    assert.equal(kept.data, "precious");

    failWake = true;
    const rebuilt = await service.restartThisComputer(id, { confirmRebuild: true });
    assert.equal(rebuilt.state, "ready");
    const gone = await service.filesystem(cap, id, {
      operation: "read",
      path: "/home/flok/do-not-lose.txt",
    });
    assert.equal(gone.ok, false);
    const events = await service.listActivityEvents(id, { limit: 50 });
    assert.ok(events.events.some((event) => event.errorCode === "REBUILD_CONFIRM_REQUIRED"));
    assert.ok(events.events.some((event) => event.errorCode === "COMPUTER_REBUILT"));
  });

  it("serializes double pause and concurrent pause+resume", async () => {
    const service = new ComputerService(new FakeProvider());
    const { id } = await pairedComputer(service, "bird-race");
    const [first, second] = await Promise.all([
      service.pauseThisComputer(id),
      service.pauseThisComputer(id),
    ]);
    assert.equal(first.state, "paused");
    assert.equal(second.state, "paused");

    await service.wakeThisComputer(id);
    const [paused, resumed] = await Promise.all([
      service.pauseThisComputer(id),
      service.wakeThisComputer(id),
    ]);
    const final = await service.get(id);
    assert.ok(final.state === "paused" || final.state === "ready" || final.state === "running");
    assert.ok(paused.state === "paused" || paused.state === "ready" || paused.state === "running");
    assert.ok(resumed.state === "paused" || resumed.state === "ready" || resumed.state === "running");
  });

  it("queues pause until a mid-wake finishes", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const { id } = await pairedComputer(service, "bird-wake");
    await service.pauseThisComputer(id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const origWake = provider.wake.bind(provider);
    provider.wake = async (ref: string) => {
      await gate;
      await origWake(ref);
    };
    const waking = service.wakeThisComputer(id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await service.get(id)).state, "waking");
    const pause = service.pauseThisComputer(id);
    release();
    await waking;
    const afterPause = await pause;
    assert.equal(afterPause.state, "paused");
  });

  it("queues a second action while a confirmed rebuild is in flight", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const { id } = await pairedComputer(service, "bird-mid-rebuild");
    const origWake = provider.wake.bind(provider);
    const origProvision = provider.provision.bind(provider);
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.provision = async (spec) => {
      await gate;
      return origProvision(spec);
    };
    const rebuild = service.restartThisComputer(id, { confirmRebuild: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pause = service.pauseThisComputer(id);
    release();
    const rebuilt = await rebuild;
    assert.equal(rebuilt.state, "ready");
    const after = await pause;
    assert.equal(after.state, "paused");
    provider.wake = origWake;
  });

  it("flags 0012 as owner-applied metadata-only SQL", () => {
    const sql = readFileSync(join(ROOT, "migrations/0012_computer_activity_events.sql"), "utf8");
    assert.match(sql, /OWNER-APPLIED/);
    assert.match(sql, /computer_activity_events/);
    assert.match(sql, /30 days/);
    const table = sql.slice(sql.indexOf("CREATE TABLE"));
    assert.doesNotMatch(table, /stdout|stderr|screenshot|token|cookie/i);
  });

  it("refuses resume and restart when wake admission is denied", async () => {
    const service = new ComputerService(new FakeProvider());
    service.setWakeAdmission(async () => false);
    const { id } = await pairedComputer(service, "bird-asleep");
    await service.pauseThisComputer(id);
    await assert.rejects(() => service.wakeThisComputer(id), (err: unknown) => err instanceof ComputerAsleep);
    await assert.rejects(() => service.restartThisComputer(id), (err: unknown) => err instanceof ComputerAsleep);
    assert.equal((await service.get(id)).state, "paused");
  });

  it("blocks bot observe/act/exec/fs rebuild after the owner declines", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const { id, token } = await pairedComputer(service, "bird-bot-block");
    const cap = auth(token);
    await service.filesystem(cap, id, {
      operation: "write",
      path: "/home/flok/keep-after-decline.txt",
      content: "still-here",
    });
    const oldRef = (await service.get(id)).providerRef;
    provider.status = async () => ({ state: "stopped" });
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    await assert.rejects(() => service.restartThisComputer(id), (err: unknown) => err instanceof RebuildConfirmRequired);
    assert.equal((await service.get(id)).rebuildConfirmRequired, true);

    await assert.rejects(() => service.exec(cap, id, { argv: ["echo", "no"] }), (err: unknown) => {
      return err instanceof RebuildConfirmRequired;
    });
    await assert.rejects(() => service.observe(cap, id, { includeAccessibility: false, includeScreenshot: false }), (err: unknown) => {
      return err instanceof RebuildConfirmRequired;
    });
    await assert.rejects(
      () => service.act(cap, id, { actions: [{ type: "wait", durationMs: 10 }] }),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    await assert.rejects(
      () => service.filesystem(cap, id, { operation: "read", path: "/home/flok/keep-after-decline.txt" }),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    const after = await service.get(id);
    assert.equal(after.providerRef, oldRef);
    assert.equal(after.rebuildConfirmRequired, true);
    assert.match(new RebuildConfirmRequired().message, /owner must confirm on the dashboard/);
  });

  it("rejects a malformed activity cursor", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    const { id } = await pairedComputer(service, "bird-bad-cursor");
    await assert.rejects(
      () => service.listActivityEvents(id, { cursor: "not-a-cursor", limit: 10 }),
      (err: unknown) => err instanceof InvalidActivityCursor,
    );
    await assert.rejects(
      () =>
        service.listActivityEvents(id, {
          cursor: Buffer.from("not-a-date\tid-1", "utf8").toString("base64url"),
          limit: 10,
        }),
      (err: unknown) => err instanceof InvalidActivityCursor,
    );
  });
});
