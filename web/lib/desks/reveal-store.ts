export type PairReveal = {
  code: string;
  pairCodeId: string;
};

export interface PairRevealStore {
  put(seatId: string, reveal: PairReveal): Promise<void>;
  get(seatId: string): Promise<PairReveal | null>;
  delete(seatId: string): Promise<void>;
}

export class MemoryPairRevealStore implements PairRevealStore {
  constructor(private readonly rows = new Map<string, PairReveal>()) {}

  async put(seatId: string, reveal: PairReveal): Promise<void> {
    this.rows.set(seatId, reveal);
  }

  async get(seatId: string): Promise<PairReveal | null> {
    return this.rows.get(seatId) ?? null;
  }

  async delete(seatId: string): Promise<void> {
    this.rows.delete(seatId);
  }
}

type PgModule = {
  default: {
    Client: new (config: { connectionString: string }) => {
      connect(): Promise<void>;
      query(text: string, values?: unknown[]): Promise<{ rows: Array<{ code: string; pair_code_id: string }> }>;
      end(): Promise<void>;
    };
  };
};

export class PostgresPairRevealStore implements PairRevealStore {
  constructor(private readonly databaseUrl: string) {}

  private async withClient<T>(
    fn: (query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ code: string; pair_code_id: string }> }>) => Promise<T>,
  ): Promise<T> {
    const pg = (await import("pg")) as unknown as PgModule;
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      return await fn((text, values) => client.query(text, values));
    } finally {
      await client.end();
    }
  }

  async put(seatId: string, reveal: PairReveal): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO pair_code_reveals (seat_id, code, pair_code_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (seat_id) DO UPDATE SET
           code = EXCLUDED.code,
           pair_code_id = EXCLUDED.pair_code_id,
           updated_at = NOW()`,
        [seatId, reveal.code, reveal.pairCodeId],
      ),
    );
  }

  async get(seatId: string): Promise<PairReveal | null> {
    const result = await this.withClient((query) =>
      query(`SELECT code, pair_code_id FROM pair_code_reveals WHERE seat_id = $1`, [seatId]),
    );
    const row = result.rows[0];
    if (!row) return null;
    return { code: row.code, pairCodeId: row.pair_code_id };
  }

  async delete(seatId: string): Promise<void> {
    await this.withClient((query) => query(`DELETE FROM pair_code_reveals WHERE seat_id = $1`, [seatId]));
  }
}
