const tails = new Map<string, Promise<unknown>>();

/** One provision at a time per seat. Postgres uses a transaction advisory lock; memory chains callers. */
export async function withSeatProvisionLock<T>(seatId: string, fn: () => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return withPgAdvisoryLock(databaseUrl, seatId, fn);
  const previous = tails.get(seatId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  tails.set(
    seatId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function withPgAdvisoryLock<T>(databaseUrl: string, seatId: string, fn: () => Promise<T>): Promise<T> {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`seat:${seatId}`]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}
