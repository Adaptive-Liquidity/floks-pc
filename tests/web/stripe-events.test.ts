import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  MemoryStripeEventStore,
  PostgresStripeEventStore,
  STRIPE_EVENT_LEASE_MS,
  claimStripeEvent,
  completeStripeEvent,
  resetStripeEventsForTests,
  setStripeEventStoreForTests,
} from "../../web/lib/billing/stripe-events.ts";

type PgErr = Error & { code: string };

function undefinedColumn(): PgErr {
  const err = new Error('column "status" does not exist') as PgErr;
  err.code = "42703";
  return err;
}

describe("stripe event lease", { concurrency: 1 }, () => {
  afterEach(() => {
    resetStripeEventsForTests();
  });

  it("returns in_flight to a second instance while the first is processing", async () => {
    const rows = new Map();
    const a = new MemoryStripeEventStore(rows);
    const b = new MemoryStripeEventStore(rows);
    assert.equal(await a.claim("evt_two", "checkout.session.completed"), "new");
    assert.equal(await b.claim("evt_two", "checkout.session.completed"), "in_flight");
    await a.complete("evt_two");
    assert.equal(await b.claim("evt_two", "checkout.session.completed"), "duplicate");
  });

  it("reclaims a processing row after the lease expires", async () => {
    const store = new MemoryStripeEventStore();
    const started = 1_700_000_000_000;
    assert.equal(await store.claim("evt_lease", "checkout.session.completed", started), "new");
    assert.equal(
      await store.claim("evt_lease", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS - 1),
      "in_flight",
    );
    assert.equal(
      await store.claim("evt_lease", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS),
      "new",
    );
    await store.complete("evt_lease");
    assert.equal(await store.claim("evt_lease", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS + 1), "duplicate");
  });

  it("reclaims immediately after a failed worker releases the row", async () => {
    const store = new MemoryStripeEventStore();
    assert.equal(await store.claim("evt_fail", "invoice.paid"), "new");
    await store.release("evt_fail");
    assert.equal(await store.claim("evt_fail", "invoice.paid"), "new");
  });

  it("falls back to insert-only duplicate when lease columns are missing", async () => {
    const ids = new Set<string>();
    const store = new PostgresStripeEventStore("postgres://unused", async <T>(text: string, values?: unknown[]) => {
      if (text.includes("status") || text.includes("claimed_at")) throw undefinedColumn();
      if (text.includes("INSERT")) {
        const id = String(values?.[0]);
        if (ids.has(id)) return { rows: [] as T[] };
        ids.add(id);
        return { rows: [{ id }] as T[] };
      }
      if (text.includes("DELETE")) {
        ids.delete(String(values?.[0]));
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    });
    assert.equal(await store.claim("evt_pre", "checkout.session.completed"), "new");
    assert.equal(await store.claim("evt_pre", "checkout.session.completed"), "duplicate");
    await store.release("evt_pre");
    assert.equal(await store.claim("evt_pre", "checkout.session.completed"), "new");
  });

  it("uses the default memory store through claimStripeEvent", async () => {
    resetStripeEventsForTests();
    assert.equal(await claimStripeEvent("evt_mem", "checkout.session.completed"), "new");
    assert.equal(await claimStripeEvent("evt_mem", "checkout.session.completed"), "in_flight");
    await completeStripeEvent("evt_mem");
    assert.equal(await claimStripeEvent("evt_mem", "checkout.session.completed"), "duplicate");
  });

  it("shares a durable map across two injected stores", async () => {
    const shared = new Map();
    setStripeEventStoreForTests(new MemoryStripeEventStore(shared));
    assert.equal(await claimStripeEvent("evt_inj", "checkout.session.completed"), "new");
    setStripeEventStoreForTests(new MemoryStripeEventStore(shared));
    assert.equal(await claimStripeEvent("evt_inj", "checkout.session.completed"), "in_flight");
  });

  it("two Postgres instances serialize in-flight and reclaim after the lease", async () => {
    type Row = { id: string; event_type: string; status: string; claimed_at: Date };
    const table = new Map<string, Row>();
    const query = async <T>(text: string, values?: unknown[]) => {
      const id = String(values?.[0] ?? "");
      if (text.includes("INSERT INTO stripe_events (id, event_type, status")) {
        if (table.has(id)) return { rows: [] as T[] };
        table.set(id, {
          id,
          event_type: String(values?.[1]),
          status: "processing",
          claimed_at: new Date(Number(values?.[2])),
        });
        return { rows: [{ id }] as T[] };
      }
      if (text.includes("SELECT id, event_type, status, claimed_at")) {
        const row = table.get(id);
        return { rows: (row ? [row] : []) as T[] };
      }
      if (text.includes("SET status = 'processing'")) {
        const row = table.get(id);
        const cutoff = Number(values?.[3]);
        if (
          row &&
          (row.status === "failed" || (row.status === "processing" && row.claimed_at.getTime() <= cutoff))
        ) {
          row.status = "processing";
          row.event_type = String(values?.[1]);
          row.claimed_at = new Date(Number(values?.[2]));
          return { rows: [{ id }] as T[] };
        }
        return { rows: [] as T[] };
      }
      if (text.includes("SET status = 'done'")) {
        const row = table.get(id);
        if (row) row.status = "done";
        return { rows: [] as T[] };
      }
      if (text.includes("SET status = 'failed'")) {
        const row = table.get(id);
        if (row && row.status !== "done") row.status = "failed";
        return { rows: [] as T[] };
      }
      throw new Error(`unexpected sql: ${text}`);
    };
    const a = new PostgresStripeEventStore("postgres://unused", query);
    const b = new PostgresStripeEventStore("postgres://unused", query);
    const started = 1_700_000_000_000;
    assert.equal(await a.claim("evt_pg", "checkout.session.completed", started), "new");
    assert.equal(await b.claim("evt_pg", "checkout.session.completed", started + 1_000), "in_flight");
    assert.equal(
      await b.claim("evt_pg", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS),
      "new",
    );
    await b.complete("evt_pg");
    assert.equal(await a.claim("evt_pg", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS + 1), "duplicate");
  });
});
