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
    const first = await a.claim("evt_two", "checkout.session.completed");
    assert.equal(first.claim, "new");
    if (first.claim !== "new") return;
    assert.deepEqual(await b.claim("evt_two", "checkout.session.completed"), { claim: "in_flight" });
    await a.complete("evt_two", first.claimedAt);
    assert.deepEqual(await b.claim("evt_two", "checkout.session.completed"), { claim: "duplicate" });
  });

  it("reclaims a processing row after the lease expires", async () => {
    const store = new MemoryStripeEventStore();
    const started = 1_700_000_000_000;
    assert.deepEqual(await store.claim("evt_lease", "checkout.session.completed", started), {
      claim: "new",
      claimedAt: started,
    });
    assert.deepEqual(
      await store.claim("evt_lease", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS - 1),
      { claim: "in_flight" },
    );
    assert.deepEqual(await store.claim("evt_lease", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS), {
      claim: "new",
      claimedAt: started + STRIPE_EVENT_LEASE_MS,
    });
    await store.complete("evt_lease", started + STRIPE_EVENT_LEASE_MS);
    assert.deepEqual(
      await store.claim("evt_lease", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS + 1),
      { claim: "duplicate" },
    );
  });

  it("reclaims immediately after a failed worker releases the row", async () => {
    const store = new MemoryStripeEventStore();
    const first = await store.claim("evt_fail", "invoice.paid");
    assert.equal(first.claim, "new");
    if (first.claim !== "new") return;
    await store.release("evt_fail", first.claimedAt);
    const retried = await store.claim("evt_fail", "invoice.paid");
    assert.equal(retried.claim, "new");
  });

  it("ignores complete and release from a stale claimant after reclaim", async () => {
    const store = new MemoryStripeEventStore();
    const started = 1_700_000_000_000;
    const first = await store.claim("evt_owner", "invoice.paid", started);
    assert.deepEqual(first, { claim: "new", claimedAt: started });
    const reclaimed = await store.claim("evt_owner", "invoice.paid", started + STRIPE_EVENT_LEASE_MS);
    assert.deepEqual(reclaimed, { claim: "new", claimedAt: started + STRIPE_EVENT_LEASE_MS });
    await store.complete("evt_owner", started);
    assert.deepEqual(await store.claim("evt_owner", "invoice.paid", started + STRIPE_EVENT_LEASE_MS + 1), {
      claim: "in_flight",
    });
    await store.release("evt_owner", started);
    assert.deepEqual(await store.claim("evt_owner", "invoice.paid", started + STRIPE_EVENT_LEASE_MS + 2), {
      claim: "in_flight",
    });
    await store.complete("evt_owner", started + STRIPE_EVENT_LEASE_MS);
    assert.deepEqual(await store.claim("evt_owner", "invoice.paid", started + STRIPE_EVENT_LEASE_MS + 3), {
      claim: "duplicate",
    });
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
    const first = await store.claim("evt_pre", "checkout.session.completed");
    assert.equal(first.claim, "new");
    if (first.claim !== "new") return;
    assert.deepEqual(await store.claim("evt_pre", "checkout.session.completed"), { claim: "duplicate" });
    await store.release("evt_pre", first.claimedAt);
    assert.equal((await store.claim("evt_pre", "checkout.session.completed")).claim, "new");
  });

  it("retries the lease insert after a missing-column error instead of caching it", async () => {
    type Row = { id: string; event_type: string; status: string; claimed_at: Date };
    const table = new Map<string, Row>();
    let leaseColumns = false;
    let leaseInserts = 0;
    const store = new PostgresStripeEventStore("postgres://unused", async <T>(text: string, values?: unknown[]) => {
      if (text.includes("INSERT INTO stripe_events (id, event_type, status")) {
        leaseInserts += 1;
        if (!leaseColumns) throw undefinedColumn();
        const id = String(values?.[0]);
        const claimedAt = new Date(Number(values?.[2]));
        if (table.has(id)) return { rows: [] as T[] };
        table.set(id, {
          id,
          event_type: String(values?.[1]),
          status: "processing",
          claimed_at: claimedAt,
        });
        return { rows: [{ id, claimed_at: claimedAt }] as T[] };
      }
      if (text.includes("INSERT INTO stripe_events (id, event_type)")) {
        const id = String(values?.[0]);
        if (table.has(id)) return { rows: [] as T[] };
        table.set(id, {
          id,
          event_type: String(values?.[1]),
          status: "done",
          claimed_at: new Date(0),
        });
        return { rows: [{ id }] as T[] };
      }
      throw new Error(`unexpected sql: ${text}`);
    });
    const first = await store.claim("evt_pre_flip", "checkout.session.completed", 1_700_000_000_000);
    assert.equal(first.claim, "new");
    assert.equal(leaseInserts, 1);
    leaseColumns = true;
    const next = await store.claim("evt_post_flip", "checkout.session.completed", 1_700_000_000_100);
    assert.deepEqual(next, { claim: "new", claimedAt: 1_700_000_000_100 });
    assert.equal(leaseInserts, 2, "missing lease columns must not be cached");
  });

  it("uses the default memory store through claimStripeEvent", async () => {
    resetStripeEventsForTests();
    const first = await claimStripeEvent("evt_mem", "checkout.session.completed");
    assert.equal(first.claim, "new");
    if (first.claim !== "new") return;
    assert.deepEqual(await claimStripeEvent("evt_mem", "checkout.session.completed"), { claim: "in_flight" });
    await completeStripeEvent("evt_mem", first.claimedAt);
    assert.deepEqual(await claimStripeEvent("evt_mem", "checkout.session.completed"), { claim: "duplicate" });
  });

  it("shares a durable map across two injected stores", async () => {
    const shared = new Map();
    setStripeEventStoreForTests(new MemoryStripeEventStore(shared));
    const first = await claimStripeEvent("evt_inj", "checkout.session.completed");
    assert.equal(first.claim, "new");
    setStripeEventStoreForTests(new MemoryStripeEventStore(shared));
    assert.deepEqual(await claimStripeEvent("evt_inj", "checkout.session.completed"), { claim: "in_flight" });
  });

  it("two Postgres instances serialize in-flight and reclaim after the lease", async () => {
    type Row = { id: string; event_type: string; status: string; claimed_at: Date };
    const table = new Map<string, Row>();
    const query = async <T>(text: string, values?: unknown[]) => {
      const id = String(values?.[0] ?? "");
      if (text.includes("INSERT INTO stripe_events (id, event_type, status")) {
        if (table.has(id)) return { rows: [] as T[] };
        const claimedAt = new Date(Number(values?.[2]));
        table.set(id, {
          id,
          event_type: String(values?.[1]),
          status: "processing",
          claimed_at: claimedAt,
        });
        return { rows: [{ id, claimed_at: claimedAt }] as T[] };
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
          return { rows: [{ id, claimed_at: row.claimed_at }] as T[] };
        }
        return { rows: [] as T[] };
      }
      if (text.includes("SET status = 'done'")) {
        const row = table.get(id);
        const owner = Number(values?.[1]);
        if (row && row.claimed_at.getTime() === owner) row.status = "done";
        return { rows: [] as T[] };
      }
      if (text.includes("SET status = 'failed'")) {
        const row = table.get(id);
        const owner = Number(values?.[1]);
        if (row && row.claimed_at.getTime() === owner && row.status !== "done") row.status = "failed";
        return { rows: [] as T[] };
      }
      throw new Error(`unexpected sql: ${text}`);
    };
    const a = new PostgresStripeEventStore("postgres://unused", query);
    const b = new PostgresStripeEventStore("postgres://unused", query);
    const started = 1_700_000_000_000;
    assert.deepEqual(await a.claim("evt_pg", "checkout.session.completed", started), {
      claim: "new",
      claimedAt: started,
    });
    assert.deepEqual(await b.claim("evt_pg", "checkout.session.completed", started + 1_000), {
      claim: "in_flight",
    });
    assert.deepEqual(await b.claim("evt_pg", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS), {
      claim: "new",
      claimedAt: started + STRIPE_EVENT_LEASE_MS,
    });
    await b.complete("evt_pg", started);
    assert.deepEqual(await a.claim("evt_pg", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS + 1), {
      claim: "in_flight",
    });
    await b.complete("evt_pg", started + STRIPE_EVENT_LEASE_MS);
    assert.deepEqual(await a.claim("evt_pg", "checkout.session.completed", started + STRIPE_EVENT_LEASE_MS + 1), {
      claim: "duplicate",
    });
  });
});
