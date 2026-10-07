import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ComputerService,
  FakeProvider,
  MemoryActivityStore,
  MemoryControlPlaneStore,
  ProviderNeedsReplacement,
  RebuildConfirmRequired,
  type ActivityEvent,
  type ActivityStore,
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
  lifecycleActionsForState,
  lifecycleFailure,
  REBUILD_WARNING,
} from "../../web/lib/computers/owner.ts";
import {
  resetDeskRuntimeForTests,
  setComputerServiceForTests,
} from "../../web/lib/desks/runtime.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const ORIGIN = "https://staxions-preview.vercel.app";
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../web");

let testIp = "198.51.100.1";
let testIpN = 0;

function userHeader(id: string, email: string): string {
  return JSON.stringify({ id, email });
}

function params(computerId: string): { params: Promise<{ computerId: string }> } {
  return { params: Promise.resolve({ computerId }) };
}

function getReq(computerId: string, email: string | null, extra: HeadersInit = {}): Request {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-forwarded-for": testIp,
    ...asRecord(extra),
  };
  if (email) headers["x-stax-test-user"] = userHeader(`user_${email}`, email);
  return new Request(`${ORIGIN}/api/setup/computer-lifecycle/${computerId}`, { headers });
}

function activityReq(
  computerId: string,
  email: string | null,
  query = "",
): Request {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-forwarded-for": testIp,
  };
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
    "x-forwarded-for": testIp,
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
    testIpN += 1;
    testIp = `198.51.100.${(testIpN % 200) + 1}`;
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
  });

  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("keeps client dashboard modules free of server owner/pg imports", () => {
    const files = [
      "components/SetupDesk.tsx",
      "components/computer/ComputerManageSection.tsx",
      "components/computer/ComputerLifecyclePanel.tsx",
      "components/computer/ComputerActivityLog.tsx",
      "lib/computers/dashboard.ts",
    ];
    for (const rel of files) {
      const text = readFileSync(join(WEB_ROOT, rel), "utf8");
      assert.doesNotMatch(text, /computers\/owner/, rel);
      assert.doesNotMatch(text, /computers\/index/, rel);
      assert.doesNotMatch(text, /from ["'].*billing\/seats/, rel);
      assert.doesNotMatch(text, /from ["']pg["']|require\(["']pg["']\)/, rel);
    }
  });

  it("maps desk and domain states onto running/paused/starting/stopped", () => {
    assert.equal(dashboardStatus("ready"), "running");
    assert.equal(dashboardStatus("paused"), "paused");
    assert.equal(dashboardStatus("requested"), "starting");
    assert.equal(dashboardStatus("provisioning"), "starting");
    assert.equal(dashboardStatus("waking"), "starting");
    assert.equal(dashboardStatus("stopped"), "stopped");
    assert.equal(dashboardStatus("recovering"), "working");
    assert.equal(dashboardStatus("checkpointing"), "working");
    assert.equal(dashboardStatus("error"), "stopped");
    assert.equal(dashboardStatus("restore_failed"), "stopped");
    assert.equal(dashboardStatus("cleanup_needed"), "stopped");
    assert.equal(dashboardStatus("deleted"), "stopped");
    assert.equal(dashboardStatus("recovery_failed"), "stopped");
    assert.equal(dashboardStatusFromDesk("running"), "running");
    assert.equal(dashboardStatusFromDesk("sleeping"), "paused");
    assert.equal(dashboardStatusFromDesk("provisioning"), "starting");
    assert.deepEqual(lifecycleActionsFor("running"), {
      pause: true,
      resume: false,
      restart: true,
    });
    assert.deepEqual(lifecycleActionsFor("starting"), {
      pause: false,
      resume: false,
      restart: false,
    });
    assert.deepEqual(lifecycleActionsFor("working"), {
      pause: false,
      resume: false,
      restart: false,
    });
    assert.deepEqual(lifecycleActionsFor("stopped"), {
      pause: false,
      resume: true,
      restart: true,
    });
    assert.deepEqual(lifecycleActionsFor("paused"), {
      pause: false,
      resume: true,
      restart: true,
    });
    assert.deepEqual(lifecycleActionsForState("waking"), {
      pause: false,
      resume: false,
      restart: true,
    });
    assert.deepEqual(lifecycleActionsForState("recovery_failed"), {
      pause: false,
      resume: false,
      restart: true,
    });
    assert.deepEqual(lifecycleActionsForState("recovering"), {
      pause: false,
      resume: false,
      restart: false,
    });
    assert.deepEqual(lifecycleActionsForState("requested"), {
      pause: false,
      resume: false,
      restart: false,
    });
    assert.deepEqual(lifecycleActionsForState("provisioning"), {
      pause: false,
      resume: false,
      restart: false,
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

    const anonActivity = await getActivity(activityReq(computer.id, null), params(computer.id));
    assert.equal(anonActivity.status, 401);
    assert.equal(JSON.stringify(await anonActivity.json()).includes("pause"), false);

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

    const missingOrigin = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "pause" }, { origin: "" }),
      params(computer.id),
    );
    assert.equal(missingOrigin.status, 403);
    assert.equal((await service.get(computer.id)).state, "ready");
  });

  it("rejects invalid computer ids before looking the computer up", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    await seatWithComputer("owner@example.com", service, "bird-valid");
    for (const bad of ["../other", "a/b", "one two", ""] as const) {
      const life = await getLifecycle(getReq(bad || " ", "owner@example.com"), params(bad || " "));
      assert.equal(life.status, 400, bad || "(blank)");
      const act = await getActivity(activityReq(bad || " ", "owner@example.com"), params(bad || " "));
      assert.equal(act.status, 400, `activity ${bad || "(blank)"}`);
      const post = await postLifecycle(
        postReq(bad || " ", "owner@example.com", { action: "pause" }),
        params(bad || " "),
      );
      assert.equal(post.status, 400, `post ${bad || "(blank)"}`);
    }
  });

  it("ignores the test-user header when NODE_ENV is production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
      setComputerServiceForTests(service);
      const computer = await seatWithComputer("owner@example.com", service, "bird-prod-header");
      const res = await postLifecycle(
        postReq(computer.id, "owner@example.com", { action: "pause" }),
        params(computer.id),
      );
      assert.equal(res.status, 401);
      assert.equal((await service.get(computer.id)).state, "ready");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
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
    assert.match(deniedBody.message ?? "", /files deleted/);
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

  it("serializes concurrent pause and resume from the dashboard", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-race-api");
    const [pauseRes, resumeRes] = await Promise.all([
      postLifecycle(postReq(computer.id, "owner@example.com", { action: "pause" }), params(computer.id)),
      postLifecycle(postReq(computer.id, "owner@example.com", { action: "resume" }), params(computer.id)),
    ]);
    assert.ok([200, 409].includes(pauseRes.status), `pause ${pauseRes.status}`);
    assert.ok([200, 409].includes(resumeRes.status), `resume ${resumeRes.status}`);
    const state = (await service.get(computer.id)).state;
    assert.ok(state === "paused" || state === "ready" || state === "running");
  });

  it("queues a dashboard pause until a mid-wake finishes", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider, { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-midwake-api");
    await service.pauseThisComputer(computer.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const origWake = provider.wake.bind(provider);
    provider.wake = async (ref: string) => {
      await gate;
      await origWake(ref);
    };
    const resume = postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "resume" }),
      params(computer.id),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await service.get(computer.id)).state, "waking");
    const pause = postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "pause" }),
      params(computer.id),
    );
    release();
    const resumeRes = await resume;
    const pauseRes = await pause;
    assert.equal(resumeRes.status, 200);
    assert.equal(pauseRes.status, 200);
    assert.equal((await service.get(computer.id)).state, "paused");
  });

  it("queues a dashboard pause while a confirmed rebuild is in flight", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider, { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-midrebuild-api");
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
    const rebuild = postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "restart", confirmRebuild: true }),
      params(computer.id),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pause = postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "pause" }),
      params(computer.id),
    );
    release();
    const rebuildRes = await rebuild;
    const pauseRes = await pause;
    assert.equal(rebuildRes.status, 200);
    assert.equal(pauseRes.status, 200);
    assert.equal((await service.get(computer.id)).state, "paused");
  });

  it("still pauses when the activity store throws", async () => {
    class BoomStore implements ActivityStore {
      appendCalls = 0;
      async append(): Promise<void> {
        this.appendCalls += 1;
        throw new Error("activity store down");
      }
      async list(): Promise<{ events: ActivityEvent[]; nextCursor: string | null }> {
        return { events: [], nextCursor: null };
      }
      async purgeExpired(): Promise<number> {
        return 0;
      }
    }
    const boom = new BoomStore();
    const service = new ComputerService(new FakeProvider(), { activityStore: boom });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-log-fail");
    const res = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "pause" }),
      params(computer.id),
    );
    assert.equal(res.status, 200);
    assert.equal((await service.get(computer.id)).state, "paused");
    assert.ok(boom.appendCalls > 0);
  });

  it("refuses resume and restart for past_due, canceled, and over-cap seats", async () => {
    const cases = [
      { email: "pastdue@example.com", bird: "bird-past", patch: { status: "past_due" as const } },
      { email: "canceled@example.com", bird: "bird-cancel", patch: { status: "canceled" as const } },
      {
        email: "overcap@example.com",
        bird: "bird-cap",
        patch: { status: "active" as const, secondsUsed: 10 * 3600, hoursUsed: 10, overageEnabled: false },
      },
    ];
    for (const row of cases) {
      const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
      setComputerServiceForTests(service);
      const computer = await seatWithComputer(row.email, service, row.bird);
      await service.pauseThisComputer(computer.id);
      const seats = await getSeatStore().listByEmail(row.email);
      const seat = seats[0];
      assert.ok(seat);
      await getSeatStore().upsert({ ...seat, ...row.patch });

      const resume = await postLifecycle(
        postReq(computer.id, row.email, { action: "resume" }),
        params(computer.id),
      );
      assert.equal(resume.status, 402, `resume ${row.email}`);
      const resumeBody = (await resume.json()) as { code?: string; message?: string };
      assert.equal(resumeBody.code, "COMPUTER_ASLEEP");
      assert.match(resumeBody.message ?? "", /asleep|not active/i);

      const restart = await postLifecycle(
        postReq(computer.id, row.email, { action: "restart" }),
        params(computer.id),
      );
      assert.equal(restart.status, 402, `restart ${row.email}`);
      assert.equal(((await restart.json()) as { code?: string }).code, "COMPUTER_ASLEEP");
      assert.equal((await service.get(computer.id)).state, "paused");

      const pause = await postLifecycle(
        postReq(computer.id, row.email, { action: "pause" }),
        params(computer.id),
      );
      assert.equal(pause.status, 200, `pause still allowed ${row.email}`);
    }
  });

  it("returns 400 for a malformed activity cursor", async () => {
    const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-bad-page");
    const junk = await getActivity(
      activityReq(computer.id, "owner@example.com", "?cursor=not-a-cursor"),
      params(computer.id),
    );
    assert.equal(junk.status, 400);
    assert.equal(((await junk.json()) as { message?: string }).message, "Invalid page.");
    const decoded = Buffer.from("not-a-date\tid-1", "utf8").toString("base64url");
    const badDate = await getActivity(
      activityReq(computer.id, "owner@example.com", `?cursor=${encodeURIComponent(decoded)}`),
      params(computer.id),
    );
    assert.equal(badDate.status, 400);
    for (const at of ["1", "0", "2026-02-30", "2026-02-30T00:00:00.000Z"]) {
      const cursor = Buffer.from(`${at}\tid-1`, "utf8").toString("base64url");
      const res = await getActivity(
        activityReq(computer.id, "owner@example.com", `?cursor=${encodeURIComponent(cursor)}`),
        params(computer.id),
      );
      assert.equal(res.status, 400, at);
    }
  });

  it("parks a declined rebuild so confirm restart works and the dashboard keeps an action", async () => {
    const provider = new FakeProvider();
    const service = new ComputerService(provider, { activityStore: new MemoryActivityStore() });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-stuck-dash");
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, {
      birdId: "bird-stuck-dash",
      flockId: "flock-owner@example.com",
    });
    provider.wake = async () => {
      throw new ProviderNeedsReplacement("fake");
    };

    const declined = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "restart" }),
      params(computer.id),
    );
    assert.equal(declined.status, 409);
    assert.equal((await service.get(computer.id)).state, "stopped");

    await assert.rejects(
      () => service.exec({ kind: "capability", token: paired.token }, computer.id, { argv: ["echo", "no"] }),
      (err: unknown) => err instanceof RebuildConfirmRequired,
    );
    assert.equal((await service.get(computer.id)).state, "stopped");

    const status = await getLifecycle(getReq(computer.id, "owner@example.com"), params(computer.id));
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as {
      status?: string;
      actions?: { pause: boolean; resume: boolean; restart: boolean };
      needsRebuildConfirm?: boolean;
    };
    assert.equal(statusBody.status, "stopped");
    assert.equal(statusBody.needsRebuildConfirm, true);
    assert.equal(statusBody.actions?.restart, true);
    assert.equal(statusBody.actions?.resume, true);
    assert.ok(statusBody.actions?.pause || statusBody.actions?.resume || statusBody.actions?.restart);

    const resume = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "resume" }),
      params(computer.id),
    );
    assert.equal(resume.status, 409);
    assert.equal(((await resume.json()) as { code?: string }).code, "REBUILD_CONFIRM_REQUIRED");
    assert.equal((await service.get(computer.id)).state, "stopped");

    await service.transition(computer.id, "waking");
    assert.equal((await service.get(computer.id)).state, "waking");
    const confirmed = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "restart", confirmRebuild: true }),
      params(computer.id),
    );
    assert.equal(confirmed.status, 200);
    assert.equal((await service.get(computer.id)).state, "ready");
    assert.equal((await service.get(computer.id)).rebuildConfirmRequired, false);
  });

  it("refuses dashboard restart from working-on-it states and keeps the state", async () => {
    const blocked: Array<{ via: string[]; expectStatus: string }> = [
      { via: ["recovering"], expectStatus: "working" },
      { via: ["checkpointing"], expectStatus: "working" },
      { via: ["error"], expectStatus: "stopped" },
      { via: ["recovering", "restore_failed"], expectStatus: "stopped" },
      { via: ["recovering", "cleanup_needed"], expectStatus: "stopped" },
    ];
    for (const row of blocked) {
      const service = new ComputerService(new FakeProvider(), { activityStore: new MemoryActivityStore() });
      setComputerServiceForTests(service);
      const computer = await seatWithComputer("owner@example.com", service, `bird-${row.via.join("-")}`);
      for (const to of row.via) {
        await service.transition(computer.id, to as "recovering" | "checkpointing" | "error" | "restore_failed" | "cleanup_needed");
      }
      const before = (await service.get(computer.id)).state;
      const denied = await postLifecycle(
        postReq(computer.id, "owner@example.com", { action: "restart", confirmRebuild: true }),
        params(computer.id),
      );
      assert.equal(denied.status, 409, row.via.join(">"));
      assert.equal(((await denied.json()) as { code?: string }).code, "RESTART_NOT_AVAILABLE", row.via.join(">"));
      assert.equal((await service.get(computer.id)).state, before);
      const get = await getLifecycle(getReq(computer.id, "owner@example.com"), params(computer.id));
      const body = (await get.json()) as {
        status?: string;
        actions?: { restart: boolean };
      };
      assert.equal(body.status, row.expectStatus, row.via.join(">"));
      assert.equal(body.actions?.restart, false, row.via.join(">"));
    }

    for (const state of ["requested", "provisioning"] as const) {
      const store = new MemoryControlPlaneStore();
      const service = new ComputerService(new FakeProvider(), {
        store,
        activityStore: new MemoryActivityStore(),
      });
      setComputerServiceForTests(service);
      const computer = await seatWithComputer("owner@example.com", service, `bird-dash-${state}`);
      const snap = await store.load();
      assert.ok(snap);
      const row = snap.computers.find((item) => item.id === computer.id);
      assert.ok(row);
      row.state = state;
      await store.save(snap);
      await service.reloadIfRevisionChanged();
      const before = (await service.get(computer.id)).state;
      const denied = await postLifecycle(
        postReq(computer.id, "owner@example.com", { action: "restart", confirmRebuild: true }),
        params(computer.id),
      );
      assert.equal(denied.status, 409, state);
      assert.equal(((await denied.json()) as { code?: string }).code, "RESTART_NOT_AVAILABLE", state);
      assert.equal((await service.get(computer.id)).state, before);
      const get = await getLifecycle(getReq(computer.id, "owner@example.com"), params(computer.id));
      const body = (await get.json()) as {
        status?: string;
        actions?: { restart: boolean };
      };
      assert.equal(body.status, "starting", state);
      assert.equal(body.actions?.restart, false, state);
    }
  });

  it("unlocks resume and restart after a provisioning computer with no provider ref", async () => {
    const store = new MemoryControlPlaneStore();
    const service = new ComputerService(new FakeProvider(), {
      store,
      activityStore: new MemoryActivityStore(),
    });
    setComputerServiceForTests(service);
    const computer = await seatWithComputer("owner@example.com", service, "bird-nostart");
    const snap = await store.load();
    assert.ok(snap);
    const row = snap.computers.find((item) => item.id === computer.id);
    assert.ok(row);
    row.state = "provisioning";
    row.providerRef = null;
    await store.save(snap);
    await service.reloadIfRevisionChanged();

    const life = await getLifecycle(getReq(computer.id, "owner@example.com"), params(computer.id));
    assert.equal(life.status, 200);
    const body = (await life.json()) as {
      status?: string;
      actions?: { pause: boolean; resume: boolean; restart: boolean };
    };
    assert.equal(body.status, "stopped");
    assert.deepEqual(body.actions, { pause: false, resume: true, restart: true });
    assert.equal((await service.get(computer.id)).state, "error");
    assert.equal((await service.get(computer.id)).providerRef, null);

    const restart = await postLifecycle(
      postReq(computer.id, "owner@example.com", { action: "restart" }),
      params(computer.id),
    );
    assert.equal(restart.status, 200);
    const after = await service.get(computer.id);
    assert.equal(after.state, "ready");
    assert.ok(after.providerRef);
  });
});
