import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ComputerService,
  ComputerAsleep,
  ComputerRebuilt,
  ControlPlaneBusy,
  FakeProvider,
  ActivityHistoryUnavailable,
  ActivityOutcomeUncertain,
  InvalidActivityCursor,
  MemoryActivityStore,
  MemoryControlPlaneStore,
  ProviderNeedsReplacement,
  RebuildConfirmRequired,
  RestartNotAvailable,
  StaleControlPlane,
  ACTIVITY_RETENTION_MS,
  decodeActivityCursor,
  encodeActivityCursor,
  paginateActivityEvents,
  type ActivityEvent,
  type ActivityStore,
  type ComputerState,
} from "../../src/lib/computers/index.js";
import { decideMetering } from "../../web/lib/billing/metering.ts";
import { createSeat } from "../../web/lib/billing/seats.ts";
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

function holdUntilTwoRefReplacements(
  store: MemoryControlPlaneStore,
  computerId: string,
  originalRef: string,
): void {
  const orig = store.compareAndSave.bind(store);
  let started = 0;
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  store.compareAndSave = async (snapshot, expectedRevision) => {
    const row = snapshot.computers.find((item) => item.id === computerId);
    if (row?.providerRef && row.providerRef !== originalRef) {
      started += 1;
      if (started >= 2) release();
      await bothStarted;
    }
    return orig(snapshot, expectedRevision);
  };
}

function summarizeSettled(results: PromiseSettledResult<unknown>[]): string {
  return results
    .map((row) =>
      row.status === "fulfilled"
        ? "fulfilled"
        : `rejected:${row.reason instanceof Error ? row.reason.name : String(row.reason)}`,
    )
    .join(",");
}

function isReplaceRaceLoss(row: PromiseSettledResult<unknown>): boolean {
  return (
    row.status === "rejected" &&
    (row.reason instanceof ControlPlaneBusy ||
      row.reason instanceof ComputerRebuilt ||
      row.reason instanceof RebuildConfirmRequired)
  );
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
    await service.noteHandoffAttempt({ token, operation: "handoff_send" });
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

  it("blocks exec when history is down and still pauses, stops, and revokes", async () => {
    const provider = new FakeProvider();
    let execs = 0;
    const origExec = provider.exec.bind(provider);
    provider.exec = async (ref, request) => {
      execs += 1;
      return origExec(ref, request);
    };
    const boom = new ThrowingActivityStore();
    let armed = false;
    const store: ActivityStore = {
      async append(event) {
        boom.appendCalls += 1;
        if (armed) throw new Error("activity store down");
        await new MemoryActivityStore().append(event);
      },
      async list() {
        return { events: [], nextCursor: null };
      },
      async purgeExpired() {
        return 0;
      },
    };
    const service = new ComputerService(provider, { activityStore: store });
    const { id, token } = await pairedComputer(service, "bird-boom");
    armed = true;
    await service.pauseThisComputer(id);
    assert.equal((await service.get(id)).state, "paused");
    await assert.rejects(
      () => service.exec(auth(token), id, { argv: ["echo", "still-works"] }),
      (err: unknown) => err instanceof ActivityHistoryUnavailable,
    );
    const stopped = await service.stopThisComputer(id);
    assert.equal(stopped.state, "stopped");
    await service.revokeBoundComputer(id);
    assert.equal(execs, 0);
    assert.ok(boom.appendCalls > 0);
  });

  it("does not consume a pair code when intent history fails", async () => {
    let fail = true;
    const store: ActivityStore = {
      async append() {
        if (fail) throw new Error("activity store down");
      },
      async list() {
        return { events: [], nextCursor: null };
      },
      async purgeExpired() {
        return 0;
      },
    };
    const service = new ComputerService(new FakeProvider(), { activityStore: store });
    const computer = await service.requestComputer({ birdId: "bird-pair-block", flockId: "flock-pair-block" });
    const issued = await service.issuePairCode(computer.id);
    const identity = { birdId: "bird-pair-block", flockId: "flock-pair-block" };
    await assert.rejects(
      () => service.pair(issued.code, identity),
      (err: unknown) => err instanceof ActivityHistoryUnavailable,
    );
    fail = false;
    const paired = await service.pair(issued.code, identity);
    assert.equal(typeof paired.token, "string");
  });

  it("returns UNCERTAIN after an effect when the outcome row fails and does not retry", async () => {
    const provider = new FakeProvider();
    let execs = 0;
    const origExec = provider.exec.bind(provider);
    provider.exec = async (ref, request) => {
      execs += 1;
      return origExec(ref, request);
    };
    let failOutcomes = false;
    const events: ActivityEvent[] = [];
    const store: ActivityStore = {
      async append(event) {
        if (failOutcomes && event.stage === "outcome") throw new Error("outcome down");
        events.push(event);
      },
      async list() {
        return { events: [], nextCursor: null };
      },
      async purgeExpired() {
        return 0;
      },
    };
    const service = new ComputerService(provider, { activityStore: store });
    const { id, token } = await pairedComputer(service, "bird-uncertain");
    failOutcomes = true;
    await assert.rejects(
      () => service.exec(auth(token), id, { argv: ["echo", "secret-stdout"] }),
      (err: unknown) =>
        err instanceof ActivityOutcomeUncertain &&
        err.code === "UNCERTAIN" &&
        err.operationId.length > 0 &&
        err.attemptId.length > 0,
    );
    assert.equal(execs, 1);
    const execIntents = events.filter((event) => event.operation === "exec" && event.stage === "intent");
    assert.equal(execIntents.length, 1);
    assert.equal(
      events.some((event) => event.operation === "exec" && event.stage === "outcome"),
      false,
    );
    assert.equal(JSON.stringify(events).includes("secret-stdout"), false);
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

  it("flags 0013 as an additive owner-applied history migration", () => {
    const prior = readFileSync(join(ROOT, "migrations/0012_computer_activity_events.sql"), "utf8");
    const sql = readFileSync(join(ROOT, "migrations/0013_computer_activity_history.sql"), "utf8");
    assert.match(prior, /CREATE TABLE IF NOT EXISTS computer_activity_events/);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS computer_activity_events/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS tenant_id/);
    assert.match(sql, /UNCERTAIN/);
    assert.match(sql, /staxions_purge_activity_history/);
    assert.doesNotMatch(sql, /^CREATE ROLE/m);
    assert.doesNotMatch(sql, /stdout|stderr|screenshot|cookie|pair_code/i);
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
    for (const at of ["1", "0", "2026-02-30", "2026-02-30T00:00:00.000Z"]) {
      await assert.rejects(
        () =>
          service.listActivityEvents(id, {
            cursor: Buffer.from(`${at}\tid-1`, "utf8").toString("base64url"),
            limit: 10,
          }),
        (err: unknown) => err instanceof InvalidActivityCursor,
        at,
      );
    }
    await assert.rejects(
      () =>
        service.listActivityEvents(id, {
          cursor: Buffer.from("2026-10-02T00:00:00.000Z\t!!!", "utf8").toString("base64url"),
          limit: 10,
        }),
      (err: unknown) => err instanceof InvalidActivityCursor,
    );
    const valid = encodeActivityCursor("2026-10-02T00:00:00.000Z", "evt_1");
    const page = await service.listActivityEvents(id, { cursor: valid, limit: 10 });
    assert.equal(Array.isArray(page.events), true);
  });

  it("parks a declined rebuild so the bot cannot leave the box waking", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const { id, token } = await pairedComputer(service, "bird-stuck-wake");
    const cap = auth(token);
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };

    await assert.rejects(
      () => service.restartThisComputer(id),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    const declined = await service.get(id);
    assert.equal(declined.state, "stopped");
    assert.equal(declined.rebuildConfirmRequired, true);

    await assert.rejects(
      () => service.exec(cap, id, { argv: ["echo", "no"] }),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    const afterBot = await service.get(id);
    assert.equal(afterBot.state, "stopped");
    assert.equal(afterBot.rebuildConfirmRequired, true);
    assert.notEqual(afterBot.state, "waking");

    await service.transition(id, "waking");
    assert.equal((await service.get(id)).state, "waking");
    await assert.rejects(
      () => service.wakeThisComputer(id),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    assert.equal((await service.get(id)).state, "stopped");

    await service.transition(id, "waking");
    const rebuilt = await service.restartThisComputer(id, { confirmRebuild: true });
    assert.equal(rebuilt.state, "ready");
    assert.equal(rebuilt.rebuildConfirmRequired, false);
  });

  it("clears the rebuild flag when the old devbox is already up and meters the ready box", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider);
    const { id, token } = await pairedComputer(service, "bird-vendor-back");
    const cap = auth(token);
    const originalStatus = provider.status.bind(provider);
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    await assert.rejects(
      () => service.restartThisComputer(id),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    assert.equal((await service.get(id)).rebuildConfirmRequired, true);
    assert.equal((await service.get(id)).state, "stopped");

    provider.status = async (ref: string) => ({ ...(await originalStatus(ref)), state: "running" });
    const exec = await service.exec(cap, id, { argv: ["echo", "back"] });
    assert.equal(exec.exitCode, 0);
    const after = await service.get(id);
    assert.ok(after.state === "ready" || after.state === "running");
    assert.equal(after.rebuildConfirmRequired, false);

    const decision = decideMetering({
      seat: createSeat({
        email: "back@example.com",
        plan: "personal",
        stripeCustomerId: "cus_back",
        lastMeteredAt: "2026-09-28T00:00:00.000Z",
      }),
      computerState: after.state,
      lastActiveAt: "2026-09-28T00:00:00.000Z",
      nowMs: Date.parse("2026-09-28T01:00:00.000Z"),
      idleMinutes: 30,
    });
    assert.equal(decision.action, "suspend");
    if (decision.action === "suspend") assert.equal(decision.reason, "idle");
  });

  it("allows restart only from stopped, waking, recovery_failed, ready, running, and paused", async () => {
    const allowed: ComputerState[] = ["ready", "running", "paused", "stopped", "waking", "recovery_failed"];
    for (const state of allowed) {
      const service = new ComputerService(new FakeProvider());
      const { id } = await pairedComputer(service, `bird-restart-ok-${state}`);
      if (state === "paused") await service.pauseThisComputer(id);
      else if (state === "stopped") await service.transition(id, "stopped");
      else if (state === "waking") {
        await service.transition(id, "stopped");
        await service.transition(id, "waking");
      } else if (state === "recovery_failed") {
        await service.transition(id, "recovering");
        await service.transition(id, "recovery_failed");
      } else if (state === "running") {
        await service.transition(id, "running");
      }
      const restarted = await service.restartThisComputer(id);
      assert.ok(restarted.state === "ready" || restarted.state === "running", state);
    }

    const blocked: Array<{ via: ComputerState[] }> = [
      { via: ["recovering"] },
      { via: ["checkpointing"] },
      { via: ["error"] },
      { via: ["recovering", "restore_failed"] },
      { via: ["recovering", "cleanup_needed"] },
    ];
    for (const row of blocked) {
      const service = new ComputerService(new FakeProvider());
      const { id } = await pairedComputer(service, `bird-restart-no-${row.via.join("-")}`);
      for (const to of row.via) await service.transition(id, to);
      const before = (await service.get(id)).state;
      await assert.rejects(
        () => service.restartThisComputer(id, { confirmRebuild: true }),
        (err: unknown) => err instanceof RestartNotAvailable,
        before,
      );
      assert.equal((await service.get(id)).state, before);
    }

    for (const state of ["requested", "provisioning"] as const) {
      const store = new MemoryControlPlaneStore();
      const service = new ComputerService(new FakeProvider(), { store });
      const { id } = await pairedComputer(service, `bird-restart-no-${state}`);
      const snap = await store.load();
      assert.ok(snap);
      const row = snap.computers.find((computer) => computer.id === id);
      assert.ok(row);
      row.state = state;
      await store.save(snap);
      await service.reloadIfRevisionChanged();
      await assert.rejects(
        () => service.restartThisComputer(id, { confirmRebuild: true }),
        (err: unknown) => err instanceof RestartNotAvailable,
        state,
      );
      assert.equal((await service.get(id)).state, state);
    }
  });

  it("maps a stale persist on pause or wake to ControlPlaneBusy", async () => {
    const pauseStore = new MemoryControlPlaneStore();
    const pauseService = new ComputerService(new FakeProvider(), { store: pauseStore });
    const paused = await pairedComputer(pauseService, "bird-stale-pause");
    pauseStore.compareAndSave = async () => {
      throw new StaleControlPlane();
    };
    await assert.rejects(
      () => pauseService.pauseThisComputer(paused.id),
      (err: unknown) => err instanceof ControlPlaneBusy && err.retryable === true,
    );

    const wakeStore = new MemoryControlPlaneStore();
    const wakeService = new ComputerService(new FakeProvider(), { store: wakeStore });
    const stopped = await wakeService.requestComputer({
      birdId: "bird-stale-wake",
      flockId: "flock-stale-wake",
    });
    await wakeService.transition(stopped.id, "stopped");
    wakeStore.compareAndSave = async () => {
      throw new StaleControlPlane();
    };
    await assert.rejects(
      () => wakeService.wakeThisComputer(stopped.id),
      (err: unknown) => err instanceof ControlPlaneBusy && err.retryable === true,
    );
  });

  it("destroys a newly provisioned replacement when the control-plane save is stale", async () => {
    const store = new MemoryControlPlaneStore();
    const provider = new FakeProvider();
    const service = new ComputerService(provider, { store });
    const computer = await service.requestComputer({
      birdId: "bird-stale-replace",
      flockId: "flock-stale-replace",
    });
    const originalRef = computer.providerRef;
    assert.ok(originalRef);
    const origCas = store.compareAndSave.bind(store);
    store.compareAndSave = async (snapshot, expectedRevision) => {
      const row = snapshot.computers.find((item) => item.id === computer.id);
      if (row?.providerRef && row.providerRef !== originalRef) {
        throw new StaleControlPlane();
      }
      return origCas(snapshot, expectedRevision);
    };
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    await assert.rejects(
      () => service.restartThisComputer(computer.id, { confirmRebuild: true }),
      (err: unknown) => err instanceof ControlPlaneBusy,
    );
    const live = provider.liveRefs();
    assert.equal(live.length, 1, live.join(","));
    assert.equal(live[0], originalRef);
    assert.equal((await service.get(computer.id)).providerRef, originalRef);
  });

  it("records a failed orphan destroy on the control plane, not only the activity log", async () => {
    const store = new MemoryControlPlaneStore();
    const provider = new FakeProvider();
    const service = new ComputerService(provider, { store });
    const computer = await service.requestComputer({
      birdId: "bird-orphan-note",
      flockId: "flock-orphan-note",
    });
    const originalRef = computer.providerRef;
    assert.ok(originalRef);
    const origCas = store.compareAndSave.bind(store);
    store.compareAndSave = async (snapshot, expectedRevision) => {
      const row = snapshot.computers.find((item) => item.id === computer.id);
      if (row?.providerRef && row.providerRef !== originalRef) {
        throw new StaleControlPlane();
      }
      return origCas(snapshot, expectedRevision);
    };
    const origDestroy = provider.destroy.bind(provider);
    provider.destroy = async (ref) => {
      if (ref !== originalRef) throw new Error("vendor destroy failed");
      return origDestroy(ref);
    };
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    await assert.rejects(
      () => service.restartThisComputer(computer.id, { confirmRebuild: true }),
      (err: unknown) => err instanceof ControlPlaneBusy,
    );
    const other = new ComputerService(new FakeProvider(), { store });
    await other.hydrate();
    assert.equal((await other.get(computer.id)).recoveryNote, "Replacement leftover could not be destroyed.");
  });

  it("destroys a losing replace so two confirmed restarts leave one live devbox", async () => {
    const store = new MemoryControlPlaneStore();
    const provider = new FakeProvider();
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    const a = new ComputerService(provider, { store });
    const computer = await a.requestComputer({ birdId: "bird-race-restart", flockId: "flock-race" });
    const originalRef = computer.providerRef;
    assert.ok(originalRef);
    holdUntilTwoRefReplacements(store, computer.id, originalRef);
    const b = new ComputerService(provider, { store });
    await b.hydrate();
    const results = await Promise.allSettled([
      a.restartThisComputer(computer.id, { confirmRebuild: true }),
      b.restartThisComputer(computer.id, { confirmRebuild: true }),
    ]);
    const wins = results.filter((row) => row.status === "fulfilled");
    const losses = results.filter(
      (row) => row.status === "rejected" && row.reason instanceof ControlPlaneBusy,
    );
    assert.equal(wins.length, 1, summarizeSettled(results));
    assert.equal(losses.length, 1, summarizeSettled(results));
    await a.reloadIfRevisionChanged();
    const live = provider.liveRefs();
    assert.equal(live.length, 1, live.join(","));
    assert.equal((await a.get(computer.id)).providerRef, live[0]);
    assert.notEqual(live[0], originalRef);
  });

  it("destroys a losing replace when a bot call races a confirmed rebuild", async () => {
    const store = new MemoryControlPlaneStore();
    const provider = new FakeProvider();
    const a = new ComputerService(provider, { store });
    const { id, token } = await pairedComputer(a, "bird-race-bot");
    const originalRef = (await a.get(id)).providerRef;
    assert.ok(originalRef);
    holdUntilTwoRefReplacements(store, id, originalRef);
    provider.status = async () => ({ state: "stopped" });
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    const b = new ComputerService(provider, { store });
    await b.hydrate();
    const results = await Promise.allSettled([
      a.restartThisComputer(id, { confirmRebuild: true }),
      b.exec(auth(token), id, { argv: ["echo", "race"] }),
    ]);
    const live = provider.liveRefs();
    assert.equal(live.length, 1, `${live.join(",")} ${summarizeSettled(results)}`);
    await a.reloadIfRevisionChanged();
    assert.equal((await a.get(id)).providerRef, live[0]);
    assert.notEqual(live[0], originalRef);
    assert.ok(
      results.some((row) => row.status === "fulfilled" || isReplaceRaceLoss(row)),
      summarizeSettled(results),
    );
    assert.ok(
      results.every((row) => row.status === "fulfilled" || isReplaceRaceLoss(row)),
      summarizeSettled(results),
    );
  });
});

describe("activity cursor", () => {
  it("accepts only ISO round-trip timestamps and safe ids", () => {
    const ok = encodeActivityCursor("2026-10-02T00:00:00.000Z", "abc_1");
    assert.deepEqual(decodeActivityCursor(ok), {
      at: "2026-10-02T00:00:00.000Z",
      id: "abc_1",
    });
    for (const at of ["1", "0", "2026-02-30", "2026-02-30T00:00:00.000Z", "2026-10-02T00:00:00Z"]) {
      assert.equal(decodeActivityCursor(Buffer.from(`${at}\tid-1`, "utf8").toString("base64url")), null, at);
    }
    assert.equal(
      decodeActivityCursor(Buffer.from("2026-10-02T00:00:00.000Z\tbad id", "utf8").toString("base64url")),
      null,
    );
  });
});
