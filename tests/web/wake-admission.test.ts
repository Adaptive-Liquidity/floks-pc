import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { POST as mcpPost } from "../../web/app/mcp/route.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { setGraceColumnsReady } from "../../web/lib/billing/grace-schema.ts";
import { flockIdForEmail, resetDeskRuntimeForTests, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import {
  admitComputerWake,
  decideWakeAdmission,
  enforceComputerWake,
} from "../../web/lib/desks/wake-admission.ts";
import {
  MemoryOauthStore,
  exchangeCode,
  getOauthStore,
  issueCode,
  pkceS256,
  registerClient,
  setOauthStoreForTests,
} from "../../web/lib/oauth.ts";

describe("wake admission", { concurrency: 1 }, () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
    setOauthStoreForTests(new MemoryOauthStore());
  });

  afterEach(() => {
    setComputerServiceForTests(null);
    setOauthStoreForTests(new MemoryOauthStore());
    resetDeskRuntimeForTests();
    resetSeatStoreForTests();
  });

  it("lets an in-grace seat wake and returns 402 when grace is expired or hours are empty", () => {
    const now = Date.now();
    const inGrace = decideWakeAdmission(
      {
        status: "past_due",
        graceUntil: new Date(now + 60_000).toISOString(),
        hoursIncluded: 10,
        secondsUsed: 0,
        overageEnabled: false,
      },
      now,
    );
    assert.deepEqual(inGrace, { allow: true });

    const expired = decideWakeAdmission(
      {
        status: "canceled",
        graceUntil: new Date(now - 1).toISOString(),
        hoursIncluded: 10,
        secondsUsed: 0,
        overageEnabled: false,
      },
      now,
    );
    assert.equal(expired.allow, false);
    if (!expired.allow) {
      assert.equal(expired.status, 402);
      assert.equal(expired.reason, "grace_expired");
    }

    setGraceColumnsReady(false);
    const missing = decideWakeAdmission(
      {
        status: "past_due",
        graceUntil: null,
        hoursIncluded: 10,
        secondsUsed: 0,
        overageEnabled: false,
      },
      now,
    );
    assert.equal(missing.allow, false);
    if (!missing.allow) assert.equal(missing.reason, "grace_expired");

    const empty = decideWakeAdmission(
      {
        status: "active",
        graceUntil: null,
        hoursIncluded: 10,
        secondsUsed: 10 * 3600,
        overageEnabled: false,
      },
      now,
    );
    assert.equal(empty.allow, false);
    if (!empty.allow) {
      assert.equal(empty.status, 402);
      assert.equal(empty.reason, "hours_empty");
    }
  });

  it("pauses an expired-grace computer on the shared wake helper", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const computer = await service.requestComputer({ birdId: "bird-hold", flockId: "flock-hold" });
    await getSeatStore().upsert(
      createSeat({
        email: "hold@example.com",
        plan: "personal",
        stripeCustomerId: "cus_hold",
        status: "past_due",
        computerId: computer.id,
        computerIds: [computer.id],
        graceUntil: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    const decision = await enforceComputerWake(computer.id);
    assert.equal(decision.allow, false);
    if (!decision.allow) assert.equal(decision.status, 402);
    assert.equal(await admitComputerWake(computer.id), false);
    assert.equal((await service.get(computer.id)).state, "paused");
  });

  it("returns HTTP 402 on the MCP path when grace has expired", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const email = "mcp402@example.com";
    const flock = flockIdForEmail(email);
    const computer = await service.requestComputer({ birdId: "bird-mcp402", flockId: flock });
    await getSeatStore().upsert(
      createSeat({
        email,
        plan: "personal",
        stripeCustomerId: "cus_mcp402",
        status: "canceled",
        computerId: computer.id,
        computerIds: [computer.id],
        graceUntil: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const redirect = client.redirectUris[0] ?? "";
    const subject = "user_mcp402";
    const code = await issueCode({
      clientId: client.id,
      redirectUri: redirect,
      challenge: pkceS256(verifier),
      subject,
      flock,
      email,
    });
    const exchanged = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: redirect,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    const issued = await service.issueBoundCapability(computer.id, flock);
    const updated = await getOauthStore().bindLiveTokens({
      clientId: client.id,
      subject,
      computerId: issued.computerHandle,
      capabilityId: issued.capabilityId,
    });
    assert.equal(updated, 1);

    const res = await mcpPost(
      new Request("https://staxions-preview.vercel.app/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${exchanged.token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "computer_status", arguments: {} },
        }),
      }),
    );
    assert.equal(res.status, 402);
    assert.equal(((await res.json()) as { reason?: string }).reason, "grace_expired");
    assert.equal((await service.get(computer.id)).state, "paused");
  });

  it("wakes an in-grace seat on the MCP path", async () => {
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const email = "mcpok@example.com";
    const flock = flockIdForEmail(email);
    const computer = await service.requestComputer({ birdId: "bird-mcpok", flockId: flock });
    await getSeatStore().upsert(
      createSeat({
        email,
        plan: "personal",
        stripeCustomerId: "cus_mcpok",
        status: "past_due",
        computerId: computer.id,
        computerIds: [computer.id],
        graceUntil: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const redirect = client.redirectUris[0] ?? "";
    const subject = "user_mcpok";
    const code = await issueCode({
      clientId: client.id,
      redirectUri: redirect,
      challenge: pkceS256(verifier),
      subject,
      flock,
      email,
    });
    const exchanged = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: redirect,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    const issued = await service.issueBoundCapability(computer.id, flock);
    await getOauthStore().bindLiveTokens({
      clientId: client.id,
      subject,
      computerId: issued.computerHandle,
      capabilityId: issued.capabilityId,
    });

    const res = await mcpPost(
      new Request("https://staxions-preview.vercel.app/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${exchanged.token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "computer_status", arguments: {} },
        }),
      }),
    );
    assert.equal(res.status, 200);
  });
});
