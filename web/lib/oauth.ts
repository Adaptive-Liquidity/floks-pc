import { createHash, randomBytes } from "node:crypto";
import { CONNECTOR } from "./config";

export type OauthClient = {
  id: string;
  redirectUris: string[];
  clientName: string | null;
};

export type OauthCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  subject: string;
  flock: string;
  email: string;
  computerId: string | null;
  expiresAt: number;
  used: boolean;
};

export type OauthAccess = {
  tokenHash: string;
  refreshHash: string;
  subject: string;
  flock: string;
  clientId: string;
  email: string;
  computerId: string | null;
  capabilityId: string | null;
  expiresAt: number;
  refreshExpiresAt: number;
  revoked: boolean;
};

export type OauthBind = {
  clientId: string;
  subject: string;
  computerId: string;
  capabilityId: string;
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
  /** True when a different signed-in account already holds this computer. */
  computerHeldByOtherSubject(computerId: string, subject: string): Promise<boolean>;
  /** Point this client's live tokens at a computer. Leaves other accounts untouched. */
  bindLiveTokens(input: OauthBind): Promise<number>;
  /** Drop this computer from the same account's other clients so one Bot stays live. */
  releaseOtherClients(computerId: string, keep: { subject: string; clientId: string }): Promise<void>;
  /** Revoke every other live token bound to this computer. */
  revokeComputerTokens(computerId: string, keep?: { subject: string; clientId: string }): Promise<void>;
  /** Live binding for the Allow screen, if a Bot already holds this computer. */
  liveComputerBinding(computerId: string): Promise<{ clientId: string; subject: string } | null>;
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
      if (row.subject === subject || row.flock === subject) row.revoked = true;
    }
  }
  async computerHeldByOtherSubject(computerId: string, subject: string): Promise<boolean> {
    for (const row of this.access.values()) {
      if (!row.revoked && row.computerId === computerId && row.subject !== subject) return true;
    }
    return false;
  }
  async bindLiveTokens(input: OauthBind): Promise<number> {
    if (await this.computerHeldByOtherSubject(input.computerId, input.subject)) return 0;
    let n = 0;
    for (const [key, row] of this.access) {
      if (row.revoked || row.clientId !== input.clientId || row.subject !== input.subject) continue;
      this.access.set(key, {
        ...row,
        computerId: input.computerId,
        capabilityId: input.capabilityId,
      });
      n += 1;
    }
    if (n > 0) {
      await this.releaseOtherClients(input.computerId, { subject: input.subject, clientId: input.clientId });
    }
    return n;
  }
  async releaseOtherClients(computerId: string, keep: { subject: string; clientId: string }): Promise<void> {
    await this.revokeComputerTokens(computerId, keep);
  }
  async revokeComputerTokens(computerId: string, keep?: { subject: string; clientId: string }): Promise<void> {
    for (const [key, row] of this.access) {
      if (row.revoked || row.computerId !== computerId) continue;
      if (keep && row.subject === keep.subject && row.clientId === keep.clientId) continue;
      this.access.set(key, { ...row, revoked: true, computerId: null, capabilityId: null });
    }
  }
  async liveComputerBinding(computerId: string): Promise<{ clientId: string; subject: string } | null> {
    for (const row of this.access.values()) {
      if (!row.revoked && row.computerId === computerId) {
        return { clientId: row.clientId, subject: row.subject };
      }
    }
    return null;
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
        `INSERT INTO oauth_clients (id, redirect_uris, client_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET redirect_uris = EXCLUDED.redirect_uris, client_name = EXCLUDED.client_name`,
        [client.id, client.redirectUris, client.clientName],
      ),
    );
  }
  async getClient(id: string): Promise<OauthClient | null> {
    const result = await this.withClient((query) =>
      query(`SELECT id, redirect_uris, client_name FROM oauth_clients WHERE id = $1`, [id]),
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      redirectUris: row.redirect_uris as string[],
      clientName: row.client_name ? String(row.client_name) : null,
    };
  }
  async saveCode(row: OauthCode): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO oauth_codes (code, client_id, redirect_uri, challenge, subject, flock, expires_at, used, computer_id, email)
         VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0),$8,$9,$10)`,
        [
          row.code,
          row.clientId,
          row.redirectUri,
          row.challenge,
          row.subject,
          row.flock,
          row.expiresAt,
          row.used,
          row.computerId,
          row.email,
        ],
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
        `INSERT INTO oauth_access_tokens (token_hash, refresh_hash, subject, flock, client_id, expires_at, refresh_expires_at, revoked, computer_id, capability_id, email)
         VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),to_timestamp($7 / 1000.0),$8,$9,$10,$11)
         ON CONFLICT (token_hash) DO UPDATE SET
           revoked = EXCLUDED.revoked,
           computer_id = EXCLUDED.computer_id,
           capability_id = EXCLUDED.capability_id,
           email = EXCLUDED.email`,
        [
          row.tokenHash,
          row.refreshHash,
          row.subject,
          row.flock,
          row.clientId,
          row.expiresAt,
          row.refreshExpiresAt,
          row.revoked,
          row.computerId,
          row.capabilityId,
          row.email,
        ],
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
    await this.withClient((query) =>
      query(`UPDATE oauth_access_tokens SET revoked = true WHERE subject = $1 OR flock = $1`, [subject]),
    );
  }
  async computerHeldByOtherSubject(computerId: string, subject: string): Promise<boolean> {
    const result = await this.withClient((query) =>
      query(
        `SELECT 1 FROM oauth_access_tokens WHERE computer_id = $1 AND subject <> $2 AND revoked = false LIMIT 1`,
        [computerId, subject],
      ),
    );
    return result.rows.length > 0;
  }
  async bindLiveTokens(input: OauthBind): Promise<number> {
    if (await this.computerHeldByOtherSubject(input.computerId, input.subject)) return 0;
    const result = await this.withClient((query) =>
      query(
        `UPDATE oauth_access_tokens
         SET computer_id = $1, capability_id = $2
         WHERE client_id = $3 AND subject = $4 AND revoked = false
         RETURNING token_hash`,
        [input.computerId, input.capabilityId, input.clientId, input.subject],
      ),
    );
    const updated = result.rows.length;
    if (updated > 0) {
      await this.releaseOtherClients(input.computerId, { subject: input.subject, clientId: input.clientId });
    }
    return updated;
  }
  async releaseOtherClients(computerId: string, keep: { subject: string; clientId: string }): Promise<void> {
    await this.revokeComputerTokens(computerId, keep);
  }
  async revokeComputerTokens(computerId: string, keep?: { subject: string; clientId: string }): Promise<void> {
    if (keep) {
      await this.withClient((query) =>
        query(
          `UPDATE oauth_access_tokens
           SET revoked = true, computer_id = NULL, capability_id = NULL
           WHERE computer_id = $1 AND revoked = false
             AND NOT (subject = $2 AND client_id = $3)`,
          [computerId, keep.subject, keep.clientId],
        ),
      );
      return;
    }
    await this.withClient((query) =>
      query(
        `UPDATE oauth_access_tokens
         SET revoked = true, computer_id = NULL, capability_id = NULL
         WHERE computer_id = $1 AND revoked = false`,
        [computerId],
      ),
    );
  }
  async liveComputerBinding(computerId: string): Promise<{ clientId: string; subject: string } | null> {
    const result = await this.withClient((query) =>
      query(
        `SELECT client_id, subject FROM oauth_access_tokens
         WHERE computer_id = $1 AND revoked = false LIMIT 1`,
        [computerId],
      ),
    );
    const row = result.rows[0];
    if (!row) return null;
    return { clientId: String(row.client_id), subject: String(row.subject) };
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
    email: row.email ? String(row.email) : "",
    computerId: row.computer_id ? String(row.computer_id) : null,
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
    email: row.email ? String(row.email) : "",
    computerId: row.computer_id ? String(row.computer_id) : null,
    capabilityId: row.capability_id ? String(row.capability_id) : null,
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

const CURSOR_REDIRECTS = new Set([
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback",
]);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export function redirectHostAllowed(uri: string): boolean {
  if (CURSOR_REDIRECTS.has(uri)) return true;
  try {
    const url = new URL(uri);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "http:") return isLoopbackHost(url.hostname);
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

export function registerClient(redirectUris: string[], clientName?: string | null): OauthClient {
  const name = clientName?.trim() ?? "";
  return { id: newId("stax"), redirectUris, clientName: name ? name.slice(0, 80) : null };
}

function loopbackRedirectMatch(registered: string, requested: string): boolean {
  try {
    const saved = new URL(registered);
    const next = new URL(requested);
    if (saved.protocol !== "http:" || next.protocol !== "http:") return false;
    if (!isLoopbackHost(saved.hostname) || !isLoopbackHost(next.hostname)) return false;
    if (saved.username || saved.password || next.username || next.password) return false;
    if (saved.hash || next.hash) return false;
    return (
      saved.hostname.toLowerCase() === next.hostname.toLowerCase() &&
      saved.pathname === next.pathname &&
      saved.search === next.search
    );
  } catch {
    return false;
  }
}

export function redirectAllowed(client: OauthClient, redirectUri: string): boolean {
  if (client.redirectUris.includes(redirectUri)) return true;
  return client.redirectUris.some((registered) => loopbackRedirectMatch(registered, redirectUri));
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
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [CONNECTOR.scope],
    bearer_methods_supported: ["header"],
  };
}

export async function issueCode(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  subject: string;
  flock: string;
  email?: string;
  computerId?: string | null;
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
    email: input.email?.trim().toLowerCase() ?? "",
    computerId: input.computerId ?? null,
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
  let capabilityId: string | null = null;
  if (consumed.computerId) {
    try {
      const { getComputerService } = await import("./desks/runtime");
      const issued = await (await getComputerService()).issueBoundCapability(consumed.computerId, consumed.flock);
      capabilityId = issued.capabilityId;
    } catch {
      return { error: "invalid_grant" };
    }
  }
  return saveTokenPair({
    subject: consumed.subject,
    flock: consumed.flock,
    clientId: consumed.clientId,
    email: consumed.email,
    computerId: consumed.computerId,
    capabilityId,
    now,
  });
}

export async function refreshAccess(
  refreshToken: string,
  clientId?: string,
  now = Date.now(),
): Promise<{ token: string; refresh: string; subject: string; flock: string } | { error: "invalid_grant" }> {
  const refreshHash = hashToken(refreshToken);
  const existing = await getOauthStore().getByRefresh(refreshHash);
  if (!existing || existing.refreshExpiresAt <= now) return { error: "invalid_grant" };
  if (clientId && clientId !== existing.clientId) return { error: "invalid_grant" };
  const row = await getOauthStore().consumeRefresh(refreshHash);
  if (!row) return { error: "invalid_grant" };
  if (row.computerId || row.capabilityId) {
    if (!row.computerId || !row.capabilityId) return { error: "invalid_grant" };
    const { getComputerService } = await import("./desks/runtime");
    const extended = await (await getComputerService()).extendBoundCapability(row.capabilityId, row.flock);
    if (!extended) return { error: "invalid_grant" };
  }
  return saveTokenPair({
    subject: row.subject,
    flock: row.flock,
    clientId: row.clientId,
    email: row.email,
    computerId: row.computerId,
    capabilityId: row.capabilityId,
    now,
  });
}

async function saveTokenPair(input: {
  subject: string;
  flock: string;
  clientId: string;
  email: string;
  computerId: string | null;
  capabilityId: string | null;
  now: number;
}) {
  const token = newId("atk");
  const refresh = newId("rtk");
  const store = getOauthStore();
  await store.saveAccess({
    tokenHash: hashToken(token),
    refreshHash: hashToken(refresh),
    subject: input.subject,
    flock: input.flock,
    clientId: input.clientId,
    email: input.email,
    computerId: input.computerId,
    capabilityId: input.capabilityId,
    expiresAt: input.now + 60 * 60_000,
    refreshExpiresAt: input.now + 30 * 24 * 60 * 60_000,
    revoked: false,
  });
  if (input.computerId) {
    await store.revokeComputerTokens(input.computerId, { subject: input.subject, clientId: input.clientId });
  }
  return { token, refresh, subject: input.subject, flock: input.flock };
}

export async function accessClaims(
  token: string,
  now = Date.now(),
): Promise<{ subject: string; flock: string; computerId: string | null; capabilityId: string | null } | null> {
  const row = await getOauthStore().getAccess(hashToken(token));
  if (!row || row.revoked || row.expiresAt <= now) return null;
  return {
    subject: row.subject,
    flock: row.flock,
    computerId: row.computerId,
    capabilityId: row.capabilityId,
  };
}

