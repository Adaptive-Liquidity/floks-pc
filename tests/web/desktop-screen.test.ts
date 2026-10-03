/**
 * Owner live-screen HTTP + token tests.
 * FakeProvider is not product proof. No paid Runloop.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ComputerAsleep, ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import { POST as desktopPost } from "../../web/app/api/setup/computers/[id]/desktop/route.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests, type SeatRecord, type SeatStatus } from "../../web/lib/billing/seats.ts";
import { DESKTOP_POLL_MAX_MS, DESKTOP_POLL_MS, desktopPollDelay } from "../../web/lib/desks/desktop-poll.ts";
import { DESKTOP_OWNER_LIMIT } from "../../web/lib/desks/desktop-rate.ts";
import {
  desktopBindSecret,
  encodeDesktopToken,
  issueDesktopPayload,
  readDesktopToken,
} from "../../web/lib/desks/desktop-token.ts";
import {
  issueOwnerDesktopToken,
  readOwnerDesktopToken,
  revokeOwnerDesktopToken,
} from "../../web/lib/desks/desktop-access.ts";
import {
  MemoryDesktopSessionStore,
  resetDesktopSessionStoreForTests,
  setDesktopSessionStoreForTests,
  type DesktopSessionRow,
  type DesktopSessionStore,
} from "../../web/lib/desks/desktop-sessions.ts";
import { flockIdForEmail, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import { admitComputerWake } from "../../web/lib/desks/wake-admission.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const ORIGIN = "https://staxions-preview.vercel.app";
const EMAIL = "owner@example.com";
const OTHER = "other@example.com";
const SUBJECT = "user_owner";
const OTHER_SUBJECT = "user_other";
const BIND = "test-bind-0123456789-abcdef-0123456789";

function userHeader(id: string, email: string): string {
  return JSON.stringify({ id, email });
}

async function callDesktop(
  computerId: string,
  body: Record<string, unknown>,
  opts?: { email?: string; subject?: string; origin?: string | null; auth?: boolean },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Accept: "application/json",
  };
  if (opts?.origin !== null) headers.origin = opts?.origin ?? ORIGIN;
  if (opts?.auth !== false) {
    headers["x-stax-test-user"] = userHeader(opts?.subject ?? SUBJECT, opts?.email ?? EMAIL);
  }
  const res = await desktopPost(
    new Request(`${ORIGIN}/api/setup/computers/${computerId}/desktop`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: computerId }) },
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function seededComputer(bird = "seat:desktop"): Promise<{
  service: ComputerService;
  computerId: string;
}> {
  process.env.STAX_TEST_AUTH = "1";
  process.env.STAXIONS_BIND_SECRET = BIND;
  resetSeatStoreForTests();
  resetDesktopSessionStoreForTests();
  resetRateLimitsForTests();
  const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
  service.setWakeAdmission(admitComputerWake);
  setComputerServiceForTests(service);
  const computer = await service.requestComputer({
    birdId: bird,
    flockId: flockIdForEmail(EMAIL),
  });
  await getSeatStore().upsert(
    createSeat({
      email: EMAIL,
      plan: "personal",
      stripeCustomerId: "cus_desktop",
      computerId: computer.id,
      computerIds: [computer.id],
    }),
  );
  return { service, computerId: computer.id };
}

describe("owner desktop tokens", { concurrency: 1 }, () => {
  it("keeps exactly eight MCP tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("verifies an HMAC token on a fresh instance with empty memory", async () => {
    process.env.STAXIONS_BIND_SECRET = BIND;
    const storeA = new MemoryDesktopSessionStore();
    setDesktopSessionStoreForTests(storeA);
    const issued = await issueOwnerDesktopToken({
      computerId: "cmp_a",
      email: EMAIL,
      subject: SUBJECT,
      mode: "view",
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    setDesktopSessionStoreForTests(new MemoryDesktopSessionStore());
    const read = await readOwnerDesktopToken({
      token: issued.token,
      computerId: "cmp_a",
      email: EMAIL,
      subject: SUBJECT,
    });
    assert.equal(read.ok, true);
  });

  it("revokes across instances that share the durable store", async () => {
    process.env.STAXIONS_BIND_SECRET = BIND;
    const shared = new MemoryDesktopSessionStore();
    setDesktopSessionStoreForTests(shared);
    const issued = await issueOwnerDesktopToken({
      computerId: "cmp_b",
      email: EMAIL,
      subject: SUBJECT,
      mode: "control",
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    await revokeOwnerDesktopToken(issued.token);
    setDesktopSessionStoreForTests(shared);
    const read = await readOwnerDesktopToken({
      token: issued.token,
      computerId: "cmp_b",
      email: EMAIL,
      subject: SUBJECT,
    });
    assert.equal(read.ok, false);
    if (read.ok) return;
    assert.equal(read.reason, "revoked");
  });

  it("rejects expired and tampered tokens without a process map", () => {
    process.env.STAXIONS_BIND_SECRET = BIND;
    const secret = desktopBindSecret();
    assert.ok(secret);
    if (!secret) return;
    const expired = issueDesktopPayload({
      computerId: "cmp_c",
      email: EMAIL,
      subject: SUBJECT,
      mode: "view",
      now: Date.now() - 60_000,
      ttlMs: 1,
    });
    const token = encodeDesktopToken(expired, secret);
    assert.equal(readDesktopToken(token, secret)?.exp === expired.exp, true);
    const tampered = `${token.slice(0, -2)}aa`;
    assert.equal(readDesktopToken(tampered, secret), null);
  });
});

describe("owner desktop HTTP", { concurrency: 1 }, () => {
  it("refuses missing auth, bad CSRF, and another account", async () => {
    const { computerId } = await seededComputer("seat:deny");
    const unauth = await callDesktop(computerId, { action: "open" }, { auth: false });
    assert.equal(unauth.status, 401);
    const csrf = await callDesktop(computerId, { action: "open" }, { origin: null });
    assert.equal(csrf.status, 403);
    const other = await callDesktop(computerId, { action: "open" }, { email: OTHER, subject: OTHER_SUBJECT });
    assert.equal(other.status, 403);
    assert.match(String(other.json.message), /not on this account/);
  });

  it("refuses a missing computer id that is not on the account", async () => {
    await seededComputer("seat:missing");
    const res = await callDesktop("does-not-exist", { action: "open" });
    assert.equal(res.status, 403);
  });

  it("opens view-only, captures a screen, and records view start", async () => {
    const { service, computerId } = await seededComputer("seat:view");
    const opened = await callDesktop(computerId, { action: "open" });
    assert.equal(opened.status, 200);
    assert.equal(opened.json.mode, "view");
    assert.equal(typeof opened.json.token, "string");
    assert.doesNotMatch(JSON.stringify(opened.json), /runloop|devbox|5900|6080|password/i);
    const screen = await callDesktop(computerId, { action: "screen", token: opened.json.token });
    assert.equal(screen.status, 200);
    assert.equal(screen.json.hasScreenshot, true);
    assert.equal(typeof screen.json.screenshot, "string");
    const ops = service.listOperatorEvents().map((e) => e.operation);
    assert.ok(ops.includes("owner-view-start"));
    assert.doesNotMatch(JSON.stringify(service.listOperatorEvents()), /screenshot/i);
  });

  it("rejects expired and replayed tokens", async () => {
    const { computerId } = await seededComputer("seat:replay");
    const opened = await callDesktop(computerId, { action: "open" });
    const token = String(opened.json.token);
    const closed = await callDesktop(computerId, { action: "close", token });
    assert.equal(closed.status, 200);
    const replay = await callDesktop(computerId, { action: "screen", token });
    assert.equal(replay.status, 401);
    assert.equal(replay.json.reason, "revoked");

    const secret = desktopBindSecret();
    assert.ok(secret);
    if (!secret) return;
    const expired = encodeDesktopToken(
      issueDesktopPayload({
        computerId,
        email: EMAIL,
        subject: SUBJECT,
        mode: "view",
        now: Date.now() - 120_000,
        ttlMs: 1,
      }),
      secret,
    );
    const late = await callDesktop(computerId, { action: "screen", token: expired });
    assert.equal(late.status, 401);
    assert.equal(late.json.reason, "expired");
  });

  it("rejects a token bound to another computer or another subject", async () => {
    process.env.STAX_TEST_AUTH = "1";
    process.env.STAXIONS_BIND_SECRET = BIND;
    resetSeatStoreForTests();
    resetDesktopSessionStoreForTests();
    resetRateLimitsForTests();
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    service.setWakeAdmission(admitComputerWake);
    setComputerServiceForTests(service);
    const left = await service.requestComputer({ birdId: "seat:left", flockId: flockIdForEmail(EMAIL) });
    const right = await service.requestComputer({ birdId: "seat:right", flockId: flockIdForEmail(EMAIL) });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_two",
        computerId: left.id,
        computerIds: [left.id, right.id],
        maxComputers: 2,
      }),
    );
    const opened = await callDesktop(left.id, { action: "open" });
    const token = String(opened.json.token);
    const crossed = await callDesktop(right.id, { action: "screen", token });
    assert.equal(crossed.status, 403);
    assert.equal(crossed.json.reason, "mismatch");
    const stolen = await callDesktop(left.id, { action: "screen", token }, {
      email: OTHER,
      subject: OTHER_SUBJECT,
    });
    assert.equal(stolen.status, 403);
  });

  it("returns 404 when the seat lists a computer the control plane lost", async () => {
    process.env.STAX_TEST_AUTH = "1";
    process.env.STAXIONS_BIND_SECRET = BIND;
    resetSeatStoreForTests();
    resetDesktopSessionStoreForTests();
    resetRateLimitsForTests();
    const ghost = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    ghost.setWakeAdmission(admitComputerWake);
    setComputerServiceForTests(ghost);
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_ghost",
        computerId: "ghost-computer",
        computerIds: ["ghost-computer"],
      }),
    );
    const res = await callDesktop("ghost-computer", { action: "open" });
    assert.equal(res.status, 404);
  });

  it("offers wake on a paused computer instead of erroring", async () => {
    const { service, computerId } = await seededComputer("seat:paused");
    await service.pauseThisComputer(computerId);
    const opened = await callDesktop(computerId, { action: "open" });
    assert.equal(opened.status, 200);
    assert.equal(opened.json.needsWake, true);
    const screen = await callDesktop(computerId, { action: "screen", token: opened.json.token });
    assert.equal(screen.status, 200);
    assert.equal(screen.json.needsWake, true);
    assert.equal(screen.json.screenshot, undefined);
    const woken = await callDesktop(computerId, { action: "wake" });
    assert.equal(woken.status, 200);
    assert.equal(woken.json.needsWake, false);
    const live = await callDesktop(computerId, { action: "screen", token: opened.json.token });
    assert.equal(live.status, 200);
    assert.equal(live.json.hasScreenshot, true);
  });

  it("rotates tokens on take control and hand back", async () => {
    const { service, computerId } = await seededComputer("seat:take");
    const opened = await callDesktop(computerId, { action: "open" });
    const viewToken = String(opened.json.token);
    const take = await callDesktop(computerId, { action: "take_control", token: viewToken });
    assert.equal(take.status, 200);
    assert.equal(take.json.mode, "control");
    const controlToken = String(take.json.token);
    assert.notEqual(controlToken, viewToken);
    const replayView = await callDesktop(computerId, { action: "act", token: viewToken, actions: [{ type: "key", key: "Return" }] });
    assert.ok(replayView.status === 401 || replayView.status === 403);
    const act = await callDesktop(computerId, {
      action: "act",
      token: controlToken,
      actions: [{ type: "click_coordinates", x: 8, y: 8 }],
    });
    assert.equal(act.status, 200);
    const denied = await callDesktop(computerId, {
      action: "act",
      token: controlToken,
      actions: [{ type: "open_url", url: "https://example.com" }],
    });
    assert.equal(denied.status, 400);
    const back = await callDesktop(computerId, { action: "hand_back", token: controlToken });
    assert.equal(back.status, 200);
    assert.equal(back.json.mode, "view");
    const replayControl = await callDesktop(computerId, {
      action: "act",
      token: controlToken,
      actions: [{ type: "key", key: "Return" }],
    });
    assert.ok(replayControl.status === 401 || replayControl.status === 403);
    const ops = service.listOperatorEvents().map((e) => e.operation);
    assert.ok(ops.includes("owner-takeover-start"));
    assert.ok(ops.includes("owner-takeover-stop"));
  });

  it("does not 500 on concurrent open and take-control", async () => {
    const { computerId } = await seededComputer("seat:race");
    const [a, b] = await Promise.all([
      callDesktop(computerId, { action: "open" }),
      callDesktop(computerId, { action: "open" }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const token = String(a.json.token);
    const [c, d] = await Promise.all([
      callDesktop(computerId, { action: "take_control", token }),
      callDesktop(computerId, { action: "take_control", token }),
    ]);
    assert.ok(c.status < 500);
    assert.ok(d.status < 500);
    assert.ok(c.status === 200 || d.status === 200);
  });

  it("returns 504 when observe times out", async () => {
    process.env.STAX_TEST_AUTH = "1";
    process.env.STAXIONS_BIND_SECRET = BIND;
    resetSeatStoreForTests();
    resetDesktopSessionStoreForTests();
    resetRateLimitsForTests();
    class Slow extends FakeProvider {
      async observe(): Promise<{ screenWidth: number; screenHeight: number }> {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 80);
        });
        return { screenWidth: 1, screenHeight: 1 };
      }
    }
    const service = new ComputerService(new Slow(), { store: new MemoryControlPlaneStore() });
    service.setWakeAdmission(admitComputerWake);
    const original = service.ownerDesktopWatch.bind(service);
    service.ownerDesktopWatch = (id: string) => original(id, { timeoutMs: 20 });
    setComputerServiceForTests(service);
    const computer = await service.requestComputer({
      birdId: "seat:timeout",
      flockId: flockIdForEmail(EMAIL),
    });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_timeout",
        computerId: computer.id,
        computerIds: [computer.id],
      }),
    );
    const opened = await callDesktop(computer.id, { action: "open" });
    const screen = await callDesktop(computer.id, { action: "screen", token: opened.json.token });
    assert.equal(screen.status, 504);
    assert.equal(screen.json.reason, "timeout");
  });

  it("matches the quiet account page and does not add an MCP tool", () => {
    const desk = readFileSync(new URL("../../web/components/SetupDesk.tsx", import.meta.url), "utf8");
    const screen = readFileSync(new URL("../../web/components/ComputerScreen.tsx", import.meta.url), "utf8");
    const tools = readFileSync(new URL("../../src/lib/mcp/tools.ts", import.meta.url), "utf8");
    assert.match(desk, /Open screen/);
    assert.match(screen, /Take control/);
    assert.match(screen, /Hand back/);
    assert.match(screen, /You have control/);
    assert.match(screen, /visibilitychange/);
    assert.match(screen, /desktopPollDelay/);
    assert.match(screen, /inFlightRef/);
    assert.doesNotMatch(screen, /setInterval/);
    assert.doesNotMatch(screen, /neon|glow|gradient|novnc|runloop\.ai/i);
    assert.doesNotMatch(tools, /computer_takeover|computer_vnc|computer_desktop/);
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });

  it("refuses wake for past_due, canceled, and over-cap seats via the screen and the service", async () => {
    const cases: Array<{ bird: string; status: SeatStatus; hoursUsed?: number }> = [
      { bird: "seat:due", status: "past_due" },
      { bird: "seat:cancel", status: "canceled" },
      { bird: "seat:cap", status: "active", hoursUsed: 10 },
    ];
    for (const row of cases) {
      const { service, computerId } = await seededComputer(row.bird);
      const seats = await getSeatStore().listAll();
      const seat = seats[0];
      assert.ok(seat);
      const next: SeatRecord = {
        ...seat,
        status: row.status,
        hoursUsed: row.hoursUsed ?? seat.hoursUsed,
        secondsUsed:
          typeof row.hoursUsed === "number" ? Math.round(row.hoursUsed * 3600) : seat.secondsUsed,
      };
      await getSeatStore().upsert(next);
      await service.pauseThisComputer(computerId);
      await assert.rejects(() => service.wakeThisComputer(computerId), ComputerAsleep);
      assert.equal((await service.get(computerId)).state, "paused");
      const woken = await callDesktop(computerId, { action: "wake" });
      assert.equal(woken.status, 402);
      assert.match(String(woken.json.message), /billing needs attention/i);
    }
  });

  it("opens the screen when desktop_sessions is missing from the schema", async () => {
    const { computerId } = await seededComputer("seat:notable");
    class MissingTableStore implements DesktopSessionStore {
      async save(): Promise<void> {
        throw missingTableError();
      }
      async get(): Promise<DesktopSessionRow | null> {
        throw missingTableError();
      }
      async revoke(): Promise<boolean> {
        throw missingTableError();
      }
    }
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      setDesktopSessionStoreForTests(new MissingTableStore());
      const opened = await callDesktop(computerId, { action: "open" });
      assert.equal(opened.status, 200);
      assert.equal(typeof opened.json.token, "string");
      const screen = await callDesktop(computerId, { action: "screen", token: opened.json.token });
      assert.equal(screen.status, 200);
      const closed = await callDesktop(computerId, { action: "close", token: opened.json.token });
      assert.equal(closed.status, 200);
      assert.ok(warnings.some((line) => /desktop_sessions/.test(line) && /missing|HMAC/i.test(line)));
    } finally {
      console.warn = orig;
    }
  });

  it("rate-limits one owner on the desktop route", async () => {
    const rlEmail = "rate-limit-owner@example.com";
    const rlSubject = "user_rate_limit";
    process.env.STAX_TEST_AUTH = "1";
    process.env.STAXIONS_BIND_SECRET = BIND;
    resetSeatStoreForTests();
    resetDesktopSessionStoreForTests();
    resetRateLimitsForTests();
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    service.setWakeAdmission(admitComputerWake);
    setComputerServiceForTests(service);
    const computer = await service.requestComputer({
      birdId: "seat:rl",
      flockId: flockIdForEmail(rlEmail),
    });
    await getSeatStore().upsert(
      createSeat({
        email: rlEmail,
        plan: "personal",
        stripeCustomerId: "cus_rl",
        computerId: computer.id,
        computerIds: [computer.id],
      }),
    );
    let limited = 0;
    let ok = 0;
    const statuses = new Map<number, number>();
    for (let i = 0; i < DESKTOP_OWNER_LIMIT + 1; i++) {
      const res = await callDesktop(computer.id, { action: "open" }, { email: rlEmail, subject: rlSubject });
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      if (res.status === 429) limited += 1;
      if (res.status === 200) ok += 1;
    }
    assert.equal(ok, DESKTOP_OWNER_LIMIT, `statuses=${JSON.stringify(Object.fromEntries(statuses))}`);
    assert.equal(limited, 1);
  });
});

function missingTableError(): Error {
  const err = new Error('relation "desktop_sessions" does not exist');
  (err as Error & { code: string }).code = "42P01";
  return err;
}

describe("owner desktop poll helpers", () => {
  it("does not overlap, pauses when hidden, and backs off on errors", () => {
    assert.equal(
      desktopPollDelay({ inFlight: true, hidden: false, lastError: false, lastDelayMs: DESKTOP_POLL_MS }),
      null,
    );
    assert.equal(
      desktopPollDelay({ inFlight: false, hidden: true, lastError: false, lastDelayMs: DESKTOP_POLL_MS }),
      null,
    );
    assert.equal(
      desktopPollDelay({ inFlight: false, hidden: false, lastError: false, lastDelayMs: 8_000 }),
      DESKTOP_POLL_MS,
    );
    assert.equal(
      desktopPollDelay({ inFlight: false, hidden: false, lastError: true, lastDelayMs: DESKTOP_POLL_MS }),
      3_000,
    );
    assert.equal(
      desktopPollDelay({ inFlight: false, hidden: false, lastError: true, lastDelayMs: 8_000 }),
      16_000 > DESKTOP_POLL_MAX_MS ? DESKTOP_POLL_MAX_MS : 16_000,
    );
    assert.equal(
      desktopPollDelay({ inFlight: false, hidden: false, lastError: true, lastDelayMs: DESKTOP_POLL_MAX_MS }),
      DESKTOP_POLL_MAX_MS,
    );
  });
});
