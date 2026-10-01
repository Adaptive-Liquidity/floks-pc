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
  expiresAt: number;
  used: boolean;
};

export type OauthAccess = {
  tokenHash: string;
  subject: string;
  clientId: string;
  expiresAt: number;
  revoked: boolean;
};

export interface OauthStore {
  saveClient(client: OauthClient): Promise<void>;
  getClient(id: string): Promise<OauthClient | null>;
  saveCode(row: OauthCode): Promise<void>;
  getCode(code: string): Promise<OauthCode | null>;
  markCodeUsed(code: string): Promise<void>;
  saveAccess(row: OauthAccess): Promise<void>;
  getAccess(tokenHash: string): Promise<OauthAccess | null>;
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
  async saveAccess(row: OauthAccess): Promise<void> {
    this.access.set(row.tokenHash, row);
  }
  async getAccess(tokenHash: string): Promise<OauthAccess | null> {
    return this.access.get(tokenHash) ?? null;
  }
  async revokeSubject(subject: string): Promise<void> {
    for (const row of this.access.values()) {
      if (row.subject === subject) row.revoked = true;
    }
  }
}

const globalOauth = globalThis as typeof globalThis & { __staxOauth?: OauthStore };

export function setOauthStoreForTests(next: OauthStore): void {
  globalOauth.__staxOauth = next;
}

export function getOauthStore(): OauthStore {
  if (!globalOauth.__staxOauth) globalOauth.__staxOauth = new MemoryOauthStore();
  return globalOauth.__staxOauth;
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
  now?: number;
}): Promise<string> {
  const code = newId("code");
  await getOauthStore().saveCode({
    code,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    challenge: input.challenge,
    subject: input.subject,
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
}): Promise<{ token: string; subject: string } | { error: "invalid_grant" }> {
  const row = await getOauthStore().getCode(input.code);
  const now = input.now ?? Date.now();
  if (!row || row.used || row.expiresAt <= now) return { error: "invalid_grant" };
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) return { error: "invalid_grant" };
  if (pkceS256(input.verifier) !== row.challenge) return { error: "invalid_grant" };
  await getOauthStore().markCodeUsed(input.code);
  const token = newId("atk");
  await getOauthStore().saveAccess({
    tokenHash: hashToken(token),
    subject: row.subject,
    clientId: row.clientId,
    expiresAt: now + 60 * 60_000,
    revoked: false,
  });
  return { token, subject: row.subject };
}

export async function accessSubject(token: string, now = Date.now()): Promise<string | null> {
  const row = await getOauthStore().getAccess(hashToken(token));
  if (!row || row.revoked || row.expiresAt <= now) return null;
  return row.subject;
}

export function parseAuthorizePreflightBody(text: string): { status?: string; error?: string } | null {
  try {
    const raw = JSON.parse(text) as { status?: unknown; error?: unknown };
    return {
      ...(typeof raw.status === "string" ? { status: raw.status } : {}),
      ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    };
  } catch {
    return null;
  }
}

export function oauthUiFromPreflight(
  ok: boolean,
  raw: { status?: string; error?: string; ok?: boolean } | null,
): { state: "ready" | "invalid_client" | "already_allowed" | "error" | "signed_out" | "no_plan"; detail: string | null } {
  if (raw?.error === "invalid_client") return { state: "invalid_client", detail: null };
  if (raw?.error === "already_allowed" || raw?.status === "already_allowed") {
    return { state: "already_allowed", detail: null };
  }
  if (!ok || !raw) return { state: "error", detail: null };
  if (raw.status === "signed_out") return { state: "signed_out", detail: null };
  if (raw.status === "no_plan") return { state: "no_plan", detail: null };
  if (raw.ok === false) return { state: "error", detail: null };
  if (raw.status === "ready" || raw.status === "ok" || raw.ok === true) return { state: "ready", detail: null };
  return { state: "error", detail: null };
}

