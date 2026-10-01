import { createHash, randomBytes } from "node:crypto";

export type OauthClient = {
  id: string;
  redirectUris: string[];
};

export type OauthCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  subject: string;
  flock: string;
  expiresAt: number;
  used: boolean;
};

export type OauthAccess = {
  tokenHash: string;
  refreshHash: string;
  subject: string;
  flock: string;
  clientId: string;
  expiresAt: number;
  refreshExpiresAt: number;
  revoked: boolean;
};

export interface OauthStore {
  saveClient(client: OauthClient): Promise<void>;
  getClient(id: string): Promise<OauthClient | null>;
  saveCode(row: OauthCode): Promise<void>;
  getCode(code: string): Promise<OauthCode | null>;
  markCodeUsed(code: string): Promise<void>;
  consumeCode(code: string): Promise<OauthCode | null>;
  saveAccess(row: OauthAccess): Promise<void>;
  getAccess(tokenHash: string): Promise<OauthAccess | null>;
  getByRefresh(refreshHash: string): Promise<OauthAccess | null>;
  consumeRefresh(refreshHash: string): Promise<OauthAccess | null>;
  revokeSubject(subject: string): Promise<void>;
}

export class MemoryOauthStore implements OauthStore {
  readonly clients = new Map<string, OauthClient>();
  readonly codes = new Map<string, OauthCode>();
  readonly access = new Map<string, OauthAccess>();

  async saveClient(client: OauthClient): Promise<void> {
    this.clients.set(client.id, client);
  }
  async getClient(id: string): Promise<OauthClient | null> {
    return this.clients.get(id) ?? null;
  }
  async saveCode(row: OauthCode): Promise<void> {
    this.codes.set(row.code, row);
  }
  async getCode(code: string): Promise<OauthCode | null> {
    return this.codes.get(code) ?? null;
  }
  async markCodeUsed(code: string): Promise<void> {
    const row = this.codes.get(code);
    if (row) row.used = true;
  }
  async consumeCode(code: string): Promise<OauthCode | null> {
    const row = this.codes.get(code);
    if (!row || row.used) return null;
    row.used = true;
    return { ...row };
  }
  async saveAccess(row: OauthAccess): Promise<void> {
    this.access.set(row.tokenHash, row);
  }
  async getAccess(tokenHash: string): Promise<OauthAccess | null> {
    return this.access.get(tokenHash) ?? null;
  }
  async getByRefresh(refreshHash: string): Promise<OauthAccess | null> {
    for (const row of this.access.values()) {
      if (row.refreshHash === refreshHash && !row.revoked) return row;
    }
    return null;
  }
  async consumeRefresh(refreshHash: string): Promise<OauthAccess | null> {
    for (const row of this.access.values()) {
      if (row.refreshHash === refreshHash && !row.revoked) {
        row.revoked = true;
        return { ...row };
      }
    }
    return null;
  }
  async revokeSubject(subject: string): Promise<void> {
    for (const row of this.access.values()) {
      if (row.subject === subject) row.revoked = true;
    }
  }
}

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

export class PostgresOauthStore implements OauthStore {
  constructor(private readonly databaseUrl: string) {}

  private async withClient<T>(fn: (query: PgClient["query"]) => Promise<T>): Promise<T> {
    const pg = (await import("pg")) as unknown as { default: { Client: new (config: { connectionString: string }) => PgClient } };
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      return await fn((text, values) => client.query(text, values));
    } finally {
      await client.end();
    }
  }

  async saveClient(client: OauthClient): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO oauth_clients (id, redirect_uris) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET redirect_uris = EXCLUDED.redirect_uris`,
        [client.id, client.redirectUris],
      ),
    );
  }
  async getClient(id: string): Promise<OauthClient | null> {
    const result = await this.withClient((query) => query(`SELECT id, redirect_uris FROM oauth_clients WHERE id = $1`, [id]));
    const row = result.rows[0];
    if (!row) return null;
    return { id: String(row.id), redirectUris: row.redirect_uris as string[] };
  }
  async saveCode(row: OauthCode): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO oauth_codes (code, client_id, redirect_uri, challenge, subject, flock, expires_at, used)
         VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0),$8)`,
        [row.code, row.clientId, row.redirectUri, row.challenge, row.subject, row.flock, row.expiresAt, row.used],
      ),
    );
  }
  async getCode(code: string): Promise<OauthCode | null> {
    const result = await this.withClient((query) => query(`SELECT * FROM oauth_codes WHERE code = $1`, [code]));
    return mapCode(result.rows[0]);
  }
  async markCodeUsed(code: string): Promise<void> {
    await this.consumeCode(code);
  }
  async consumeCode(code: string): Promise<OauthCode | null> {
    const result = await this.withClient((query) =>
      query(`UPDATE oauth_codes SET used = true WHERE code = $1 AND used = false RETURNING *`, [code]),
    );
    return mapCode(result.rows[0]);
  }
  async saveAccess(row: OauthAccess): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO oauth_access_tokens (token_hash, refresh_hash, subject, flock, client_id, expires_at, refresh_expires_at, revoked)
         VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),to_timestamp($7 / 1000.0),$8)
         ON CONFLICT (token_hash) DO UPDATE SET revoked = EXCLUDED.revoked`,
        [row.tokenHash, row.refreshHash, row.subject, row.flock, row.clientId, row.expiresAt, row.refreshExpiresAt, row.revoked],
      ),
    );
  }
  async getAccess(tokenHash: string): Promise<OauthAccess | null> {
    const result = await this.withClient((query) => query(`SELECT * FROM oauth_access_tokens WHERE token_hash = $1`, [tokenHash]));
    return mapAccess(result.rows[0]);
  }
  async getByRefresh(refreshHash: string): Promise<OauthAccess | null> {
    const result = await this.withClient((query) =>
      query(`SELECT * FROM oauth_access_tokens WHERE refresh_hash = $1 AND revoked = false`, [refreshHash]),
    );
    return mapAccess(result.rows[0]);
  }
  async consumeRefresh(refreshHash: string): Promise<OauthAccess | null> {
    const result = await this.withClient((query) =>
      query(
        `UPDATE oauth_access_tokens SET revoked = true WHERE refresh_hash = $1 AND revoked = false RETURNING *`,
        [refreshHash],
      ),
    );
    return mapAccess(result.rows[0]);
  }
  async revokeSubject(subject: string): Promise<void> {
    await this.withClient((query) => query(`UPDATE oauth_access_tokens SET revoked = true WHERE subject = $1`, [subject]));
  }
}

function mapCode(row: Record<string, unknown> | undefined): OauthCode | null {
  if (!row) return null;
  return {
    code: String(row.code),
    clientId: String(row.client_id),
    redirectUri: String(row.redirect_uri),
    challenge: String(row.challenge),
    subject: String(row.subject),
    flock: String(row.flock),
    expiresAt: new Date(String(row.expires_at)).getTime(),
    used: Boolean(row.used),
  };
}

function mapAccess(row: Record<string, unknown> | undefined): OauthAccess | null {
  if (!row) return null;
  return {
    tokenHash: String(row.token_hash),
    refreshHash: String(row.refresh_hash),
    subject: String(row.subject),
    flock: String(row.flock),
    clientId: String(row.client_id),
    expiresAt: new Date(String(row.expires_at)).getTime(),
    refreshExpiresAt: new Date(String(row.refresh_expires_at)).getTime(),
    revoked: Boolean(row.revoked),
  };
}

const globalOauth = globalThis as typeof globalThis & { __staxOauth?: OauthStore };

export function setOauthStoreForTests(next: OauthStore): void {
  globalOauth.__staxOauth = next;
}

export function getOauthStore(): OauthStore {
  if (globalOauth.__staxOauth) return globalOauth.__staxOauth;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  globalOauth.__staxOauth = databaseUrl ? new PostgresOauthStore(databaseUrl) : new MemoryOauthStore();
  return globalOauth.__staxOauth;
}

export function redirectHostAllowed(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "grok.com" || host.endsWith(".grok.com") || host === "x.ai" || host.endsWith(".x.ai");
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export function registerClient(redirectUris: string[]): OauthClient {
  const client = { id: newId("stax"), redirectUris };
  return client;
}

export function redirectAllowed(client: OauthClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

export function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
  };
}

export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  };
}

export async function issueCode(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  subject: string;
  flock: string;
  now?: number;
}): Promise<string> {
  const code = newId("code");
  await getOauthStore().saveCode({
    code,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    challenge: input.challenge,
    subject: input.subject,
    flock: input.flock,
    expiresAt: (input.now ?? Date.now()) + 5 * 60_000,
    used: false,
  });
  return code;
}

export async function exchangeCode(input: {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  now?: number;
}): Promise<{ token: string; refresh: string; subject: string; flock: string } | { error: "invalid_grant" }> {
  const row = await getOauthStore().getCode(input.code);
  const now = input.now ?? Date.now();
  if (!row || row.used || row.expiresAt <= now) return { error: "invalid_grant" };
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) return { error: "invalid_grant" };
  if (pkceS256(input.verifier) !== row.challenge) return { error: "invalid_grant" };
  const consumed = await getOauthStore().consumeCode(input.code);
  if (!consumed) return { error: "invalid_grant" };
  return saveTokenPair(consumed.subject, consumed.flock, consumed.clientId, now);
}

export async function refreshAccess(
  refreshToken: string,
  now = Date.now(),
): Promise<{ token: string; refresh: string; subject: string; flock: string } | { error: "invalid_grant" }> {
  const row = await getOauthStore().consumeRefresh(hashToken(refreshToken));
  if (!row || row.refreshExpiresAt <= now) return { error: "invalid_grant" };
  return saveTokenPair(row.subject, row.flock, row.clientId, now);
}

async function saveTokenPair(subject: string, flock: string, clientId: string, now: number) {
  const token = newId("atk");
  const refresh = newId("rtk");
  await getOauthStore().saveAccess({
    tokenHash: hashToken(token),
    refreshHash: hashToken(refresh),
    subject,
    flock,
    clientId,
    expiresAt: now + 60 * 60_000,
    refreshExpiresAt: now + 30 * 24 * 60 * 60_000,
    revoked: false,
  });
  return { token, refresh, subject, flock };
}

export async function accessClaims(
  token: string,
  now = Date.now(),
): Promise<{ subject: string; flock: string } | null> {
  const row = await getOauthStore().getAccess(hashToken(token));
  if (!row || row.revoked || row.expiresAt <= now) return null;
  return { subject: row.subject, flock: row.flock };
}

