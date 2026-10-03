import { DurableStoreRequired, requiresDurableStore } from "./seats";

const seen = new Set<string>();
const inFlight = new Set<string>();

export function resetStripeEventsForTests(): void {
  seen.clear();
  inFlight.clear();
}

export function isStripeEventInFlight(id: string): boolean {
  return inFlight.has(id);
}

/** Inserts the event id. A duplicate insert returns "duplicate" so the handler can skip it. */
export async function claimStripeEvent(
  id: string,
  eventType: string,
): Promise<"new" | "duplicate" | "in_flight"> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (requiresDurableStore()) {
      throw new DurableStoreRequired(
        "DATABASE_URL is required to claim Stripe events on Vercel and in production. In-memory event ids are not shared across instances.",
      );
    }
    if (inFlight.has(id)) return "in_flight";
    if (seen.has(id)) return "duplicate";
    seen.add(id);
    inFlight.add(id);
    return "new";
  }
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO stripe_events (id, event_type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, eventType],
    );
    if (result.rows.length > 0) {
      inFlight.add(id);
      return "new";
    }
    if (inFlight.has(id)) return "in_flight";
    return "duplicate";
  } finally {
    await client.end();
  }
}

export async function completeStripeEvent(id: string): Promise<void> {
  inFlight.delete(id);
}

/** Drops a claimed id so a failed handler can be retried. */
export async function releaseStripeEvent(id: string): Promise<void> {
  inFlight.delete(id);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    seen.delete(id);
    return;
  }
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`DELETE FROM stripe_events WHERE id = $1`, [id]);
  } finally {
    await client.end();
  }
}
