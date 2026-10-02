import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  ComputerService,
  FakeProvider,
  MemoryActivityStore,
  ProviderNeedsReplacement,
  RebuildConfirmRequired,
} from "../../src/lib/computers/index.js";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/index.js";
import { GET as getActivity } from "../../web/app/api/setup/computer-activity/[computerId]/route.ts";
import {
  GET as getLifecycle,
  POST as postLifecycle,
} from "../../web/app/api/setup/computer-lifecycle/[computerId]/route.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import {
  dashboardStatus,
  dashboardStatusFromDesk,
  formatLastActive,
  lifecycleActionsFor,
  lifecycleFailure,
  REBUILD_WARNING,
} from "../../web/lib/computers/owner.ts";
import {
  resetDeskRuntimeForTests,
  setComputerServiceForTests,
} from "../../web/lib/desks/runtime.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const ORIGIN = "https://staxions-preview.vercel.app";

function userHeader(id: string, email: string): string {
  return JSON.stringify({ id, email });
}

function params(computerId: string): { params: Promise<{ computerId: string }> } {
  return { params: Promise.resolve({ computerId }) };
}

function getReq(computerId: string, email: string | null, extra: HeadersInit = {}): Request {
  const headers: Record<string, string> = { Accept: "application/json", ...asRecord(extra) };
  if (email) headers["x-stax-test-user"] = userHeader(`user_${email}`, email);
  return new Request(`${ORIGIN}/api/setup/computer-lifecycle/${computerId}`, { headers });
}

function activityReq(
  computerId: string,
  email: string | null,
  query = "",
): Request {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (email) headers["x-stax-test-user"] = userHeader(`user_${email}`, email);
  return new Request(`${ORIGIN}/api/setup/computer-activity/${computerId}${query}`, { headers });
}

function postReq(
  computerId: string,
  email: string | null,
  body: unknown,
  extra: HeadersInit = {},
): Request {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "content-type": "application/json",
    origin: ORIGIN,
    ...asRecord(extra),
  };
  if (email) headers["x-stax-test-user"] = userHeader(`user_${email}`, email);
  return new Request(`${ORIGIN}/api/setup/computer-lifecycle/${computerId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function asRecord(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function seatWithComputer(
  email: string,
  service: ComputerService,
  birdId: string,
) {
  const computer = await service.requestComputer({ birdId, flockId: `flock-${email}` });
  await getSeatStore().upsert(
    createSeat({
      email,
      plan: "personal",
      stripeCustomerId: `cus_${email}`,
      computerId: computer.id,
      computerIds: [computer.id],
    }),
  );
  return computer;
}

describe("owner computer dashboard", { concurrency: 1 }, () => {
  beforeEach(() => {
    process.env.STAX_TEST_AUTH = "1";
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
  });

  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("maps desk and domain states onto running/paused/starting/stopped", () => {
    assert.equal(dashboardStatus("ready"), "running");
    assert.equal(dashboardStatus("paused"), "paused");
    assert.equal(dashboardStatus("waking"), "starting");
    assert.equal(dashboardStatus("stopped"), "stopped");
    assert.equal(dashboardStatusFromDesk("running"), "running");
    assert.equal(dashboardStatusFromDesk("sleeping"), "paused");
    assert.equal(dashboardStatusFromDesk("provisioning"), "starting");
    assert.deepEqual(lifecycleActionsFor("running"), {
      pause: true,
      resume: false,
      restart: true,
    });
    assert.equal(formatLastActive(null), "never");
    assert.match(REBUILD_WARNING, /delete its files/);
  });

  it("rejects unauthenticated and CSRF lifecycle calls", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-auth");

    const anonGet = await getLifecycle(getReq(computer.id, null), params(computer.id));
    assert.equal(anonGet.status, 401);

    const anonPost = await postLifecycle(
      postReq(computer.id, null, { action: "pause" }),
      params(computer.id),
    );
    assert.equal(anonPost.status, 401);

    const csrf = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "pause" }, { origin: "https://evil.example" }),
      params(computer.id),
    );
    assert.equal(csrf.status, 403);
    assert.equal((await service.get(computer.id)).state, "ready");
  });

  it("denies another account pause/resume/restart and activity by id", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const owned = await seatWithComputer("owner@example.com", service, "bird-owner");
    await seatWithComputer("intruder@example.com", service, "bird-intruder");
    await service.pauseThisComputer(owned.id);

    for (const action of ["pause", "resume", "restart"] as const) {
      const res = await postLifecycle(
        postReq(owned.id, "intruder@example.com", { action }),
        params(owned.id),
      );
      assert.equal(res.status, 403, action);
      const body = (await res.json()) as { message?: string };
      assert.match(body.message ?? "", /not on this account/);
    }
    const peek = await getLifecycle(getReq(owned.id, "intruder@example.com"), params(owned.id));
    assert.equal(peek.status, 403);
    const log = await getActivity(activityReq(owned.id, "intruder@example.com"), params(owned.id));
    assert.equal(log.status, 403);
    const leaked = await log.json();
    assert.equal(JSON.stringify(leaked).includes("pause"), false);
    assert.equal((await service.get(owned.id)).state, "paused");
  });

  it("lets the owner pause, resume, and read last active plus activity", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-desk");
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, {
      birdId: "bird-desk",
      flockId: "flock-owner@example.com",
    });
    await service.exec(
      { kind: "capability", token: paired.token },
      computer.id,
      { argv: ["echo", "secret-stdout"] },
    );

    const paused = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "pause" }),
      params(computer.id),
    );
    assert.equal(paused.status, 200);
    const pausedBody = (await paused.json()) as { status?: string; lastActiveAt?: string };
    assert.equal(pausedBody.status, "paused");
    assert.ok(pausedBody.lastActiveAt);

    const resumed = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "resume" }),
      params(computer.id),
    );
    assert.equal(resumed.status, 200);
    assert.equal(((await resumed.json()) as { status?: string }).status, "running");

    const status = await getLifecycle(getReq(computer.id, "owner@example.com"), params(computer.id));
    assert.equal(status.status, 200);
    const page = await getActivity(activityReq(computer.id, "owner@example.com", "?limit=20"), params(computer.id));
    assert.equal(page.status, 200);
    const body = (await page.json()) as {
      events: Array<{ operation: string }>;
      retentionDays: number;
    };
    assert.equal(body.retentionDays, 30);
    assert.ok(body.events.some((event) => event.operation === "exec"));
    assert.ok(body.events.some((event) => event.operation === "pause"));
    assert.equal(JSON.stringify(body).includes("secret-stdout"), false);
    assert.equal(JSON.stringify(body).includes(paired.token), false);
  });

  it("requires an explicit rebuild confirm when restart would wipe files", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider, { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-wipe");
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };
    const denied = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "restart" }),
      params(computer.id),
    );
    assert.equal(denied.status, 409);
    const deniedBody = (await denied.json()) as {
      code?: string;
      needsRebuildConfirm?: boolean;
      message?: string;
    };
    assert.equal(deniedBody.code, "REBUILD_CONFIRM_REQUIRED");
    assert.equal(deniedBody.needsRebuildConfirm, true);
    assert.match(deniedBody.message ?? "", /delete its files/);
    const mapped = lifecycleFailure(new RebuildConfirmRequired());
    assert.equal(mapped.body.needsRebuildConfirm, true);

    const confirmed = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "restart", confirmRebuild: true }),
      params(computer.id),
    );
    assert.equal(confirmed.status, 200);
  });

  it("paginates activity for the owner only", async () => {
    let now = Date.parse("2026-10-02T00:00:00.000Z");
    const service = new ComputerService(new FakeProvider(), {
      activityStore: new MemoryActivityStore(),
      now: () => now,
    });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-pages");
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, {
      birdId: "bird-pages",
      flockId: "flock-owner@example.com",
    });
    for (let i = 0; i < 4; i += 1) {
      now += 1_000;
      await service.exec(
        { kind: "capability", token: paired.token },
        computer.id,
        { argv: ["echo", `n-${i}`] },
      );
    }
    const first = await getActivity(
      activityReq(computer.id, "owner@example.com", "?limit=2"),
      params(computer.id),
    );
    const firstBody = (await first.json()) as { events: Array<{ id: string }>; nextCursor: string | null };
    assert.equal(firstBody.events.length, 2);
    assert.ok(firstBody.nextCursor);
    const second = await getActivity(
      activityReq(
        computer.id,
        "owner@example.com",
        `?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      ),
      params(computer.id),
    );
    const secondBody = (await second.json()) as { events: Array<{ id: string }> };
    assert.equal(secondBody.events.length, 2);
    assert.notEqual(firstBody.events[0]?.id, secondBody.events[0]?.id);
  });

  it("double-clicks pause without changing account ownership checks", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-dbl");
    const [a, b] = await Promise.all([
      postLifecycle(postReq(computer.id, "owner@example.com", { action: "pause" }), params(computer.id)),
      postLifecycle(postReq(computer.id, "owner@example.com", { action: "pause" }), params(computer.id)),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal((await service.get(computer.id)).state, "paused");
  });
});
