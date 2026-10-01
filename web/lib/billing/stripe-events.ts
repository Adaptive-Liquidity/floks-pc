const seen = new Set<string>();

export function resetStripeEventsForTests(): void {
  seen.clear();
}

/** Inserts the event id. A duplicate insert returns "duplicate" so the handler can skip it. */
export async function claimStripeEvent(id: string, eventType: string): Promise<"new" | "duplicate"> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (seen.has(id)) return "duplicate";
    seen.add(id);
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
    return result.rows.length > 0 ? "new" : "duplicate";
  } finally {
    await client.end();
  }
}

/** Drops a claimed id so a failed handler can be retried. */
export async function releaseStripeEvent(id: string): Promise<void> {
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
