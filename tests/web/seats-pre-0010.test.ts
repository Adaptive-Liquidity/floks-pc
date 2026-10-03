import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { applyStripeEvent } from "../../web/lib/billing/stripe.ts";
import {
  graceAllowsAccess,
  graceExpired,
  startGrace,
} from "../../web/lib/billing/grace.ts";
import { setGraceColumnsReady } from "../../web/lib/billing/grace-schema.ts";
import { enforceBillingHold } from "../../web/lib/billing/lifecycle.ts";
import {
  PostgresSeatStore,
  createSeat,
  getSeatStore,
  resetSeatStoreForTests,
  seatSelectSql,
  seatUpsertSql,
  setSeatStoreForTests,
  type SeatSqlQuery,
} from "../../web/lib/billing/seats.ts";
import { paidCheckoutEvent, stripeEvent, useTestPriceEnv } from "./helpers/stripe-fixtures.ts";

type PgErr = Error & { code: string };

function undefinedColumn(): PgErr {
  const err = new Error('column "grace_until" does not exist') as PgErr;
  err.code = "42703";
  return err;
}

function rowFromValues(values: unknown[], hasGrace: boolean): Record<string, unknown> {
  return {
    id: values[0],
    email: values[1],
    plan: values[2],
    status: values[3],
    stripeCustomerId: values[4],
    stripeSubscriptionId: values[5],
    stripeCheckoutSessionId: values[6],
    stripePriceId: values[7],
    hoursIncluded: values[8],
    hoursUsed: values[9],
    secondsUsed: values[10],
    overageEnabled: values[11],
    maxComputers: values[12],
    agentQuantity: values[13],
    periodStart: values[14],
    periodEnd: values[15],
    computerId: values[16],
    computerIds: values[17],
    lastMeteredAt: values[18],
    graceUntil: hasGrace ? values[19] : null,
    billingEventAt: hasGrace ? values[20] : null,
    createdAt: hasGrace ? values[21] : values[19],
    updatedAt: hasGrace ? values[22] : values[20],
  };
}

class Pre0010Pg {
  readonly rows = new Map<string, Record<string, unknown>>();
  graceSqlSeen = 0;

  constructor(
    private readonly probeExists: boolean | "throw",
    private readonly throwOnGraceSql: boolean,
  ) {}

  query: SeatSqlQuery = async <T>(text: string, values: unknown[]): Promise<T[]> => {
    if (text.includes("information_schema")) {
      if (this.probeExists === "throw") throw new Error("information_schema unavailable");
      return [{ exists: this.probeExists }] as T[];
    }
    const mentionsGrace = text.includes("grace_until") || text.includes("billing_event_at");
    if (mentionsGrace) this.graceSqlSeen += 1;
    if (mentionsGrace && this.throwOnGraceSql) throw undefinedColumn();
    if (text.includes("INSERT INTO billing_seats")) {
      const row = rowFromValues(values, mentionsGrace);
      this.rows.set(String(row.id), row);
      return [] as T[];
    }
    if (text.includes("FROM billing_seats")) {
      let list = [...this.rows.values()];
      if (text.includes("WHERE email = $1")) list = list.filter((row) => row.email === values[0]);
      else if (text.includes("WHERE id = $1")) list = list.filter((row) => row.id === values[0]);
      else if (text.includes("WHERE stripe_checkout_session_id = $1")) {
        list = list.filter((row) => row.stripeCheckoutSessionId === values[0]);
      } else if (text.includes("WHERE stripe_subscription_id = $1")) {
        list = list.filter((row) => row.stripeSubscriptionId === values[0]);
      }
      return list.map((row) => ({
        ...row,
        ...(mentionsGrace
          ? {}
          : { graceUntil: undefined, billingEventAt: undefined }),
      })) as T[];
    }
    throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
  };
}

describe("seats without migration 0010", { concurrency: 1 }, () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    useTestPriceEnv();
    resetSeatStoreForTests();
  });

  afterEach(() => {
    resetSeatStoreForTests();
  });

  it("uses pre-0010 SQL when information_schema says grace columns are missing", async () => {
    assert.equal(seatSelectSql(false).includes("grace_until"), false);
    assert.equal(seatUpsertSql(false).includes("grace_until"), false);
    assert.match(seatSelectSql(true), /grace_until/);
    assert.match(seatUpsertSql(true), /grace_until/);

    const pg = new Pre0010Pg(false, true);
    const store = new PostgresSeatStore("postgres://unused", pg.query);
    setSeatStoreForTests(store);

    const paid = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_pre0010", email: "pre0010@example.com", eventId: "evt_pre0010" }),
    );
    assert.ok(paid);
    assert.equal(paid.graceUntil, null);
    assert.equal(paid.billingEventAt, null);
    assert.equal(pg.graceSqlSeen, 0);

    const listed = await getSeatStore().listByEmail("pre0010@example.com");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, paid.id);
    assert.equal(listed[0]?.status, "active");
    assert.equal(listed[0]?.graceUntil, null);

    const failed = await applyStripeEvent(
      stripeEvent(
        "invoice.payment_failed",
        { subscription: "sub_cs_pre0010", customer: "cus_cs_pre0010" },
        { id: "evt_pre0010_fail", created: 1_700_000_200 },
      ),
    );
    assert.equal(failed?.status, "past_due");
    assert.equal(failed?.graceUntil, null);
    assert.equal(graceExpired(failed), false);
    assert.equal(graceAllowsAccess(failed), true);
    const held = await enforceBillingHold(failed);
    assert.equal(held.status, "past_due");
    assert.equal(held.computerId, failed.computerId);
  });

  it("falls back after Postgres 42703 when the probe is wrong", async () => {
    const pg = new Pre0010Pg(true, true);
    const store = new PostgresSeatStore("postgres://unused", pg.query);
    setSeatStoreForTests(store);

    const seat = await store.upsert(
      createSeat({
        email: "colmiss@example.com",
        plan: "personal",
        stripeCustomerId: "cus_colmiss",
        stripeCheckoutSessionId: "cs_colmiss",
        graceUntil: new Date(Date.now() + 3600_000).toISOString(),
        billingEventAt: new Date().toISOString(),
      }),
    );
    assert.ok(pg.graceSqlSeen >= 1);
    assert.equal(seat.graceUntil, null);
    assert.equal(seat.billingEventAt, null);
    const found = await store.getByCheckoutSession("cs_colmiss");
    assert.equal(found?.id, seat.id);
    assert.equal(found?.email, "colmiss@example.com");
    assert.equal(found?.graceUntil, null);
  });

  it("no-ops grace helpers when columns are marked absent", async () => {
    setGraceColumnsReady(false);
    const seat = createSeat({
      email: "nocol@example.com",
      plan: "personal",
      stripeCustomerId: "cus_nocol",
      status: "canceled",
    });
    assert.equal(startGrace(seat).graceUntil, null);
    assert.equal(graceExpired({ status: "past_due", graceUntil: null }), false);
    assert.equal(graceAllowsAccess({ status: "canceled", graceUntil: null }), true);
    const held = await enforceBillingHold({ ...seat, status: "past_due" });
    assert.equal(held.status, "past_due");
  });
});
