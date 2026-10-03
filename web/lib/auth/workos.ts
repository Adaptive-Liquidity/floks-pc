import { WorkOS } from "@workos-inc/node";
import { COOKIE_NAME } from "../config";

export { COOKIE_NAME };

export class AuthNotConfigured extends Error {
  constructor(message = "WorkOS AuthKit is not configured") {
    super(message);
    this.name = "AuthNotConfigured";
  }
}

export type AuthUser = {
  id: string;
  email: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new AuthNotConfigured(`${name} is required`);
  return value;
}

export function workosConfigured(): boolean {
  return Boolean(
    process.env.WORKOS_CLIENT_ID?.trim() &&
      process.env.WORKOS_API_KEY?.trim() &&
      process.env.WORKOS_COOKIE_PASSWORD?.trim(),
  );
}

export function cookiePassword(): string {
  const password = requiredEnv("WORKOS_COOKIE_PASSWORD");
  if (password.length < 32) {
    throw new AuthNotConfigured("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  return password;
}

export function workosClientId(): string {
  return requiredEnv("WORKOS_CLIENT_ID");
}

let client: WorkOS | null = null;

export function getWorkOS(): WorkOS {
  if (!client) {
    client = new WorkOS(requiredEnv("WORKOS_API_KEY"), {
      clientId: workosClientId(),
    });
  }
  return client;
}

export function resetWorkosClientForTests(): void {
  client = null;
}

export function redirectUri(origin: string): string {
  const explicit = process.env.WORKOS_REDIRECT_URI?.replace(/\/+$/, "");
  if (explicit) return explicit;
  return `${origin.replace(/\/+$/, "")}/callback`;
}

export type AuthKitScreenHint = "sign-in" | "sign-up";

export function authKitScreenHint(input?: string | null): AuthKitScreenHint {
  return input === "sign-up" ? "sign-up" : "sign-in";
}

/** Missing WorkOS must not look like an invalid invitation. Land on account home. */
export function authStartFallbackPath(): "/setup" {
  return "/setup";
}

export function getAuthKitLoginUrl(options: {
  origin: string;
  email?: string | null;
  state?: string | null;
  screenHint?: AuthKitScreenHint;
}): string {
  const params: {
    provider: "authkit";
    clientId: string;
    redirectUri: string;
    screenHint: AuthKitScreenHint;
    loginHint?: string;
    state?: string;
  } = {
    provider: "authkit",
    clientId: workosClientId(),
    redirectUri: redirectUri(options.origin),
    screenHint: options.screenHint ?? "sign-in",
  };
  if (options.email) params.loginHint = options.email;
  if (options.state) params.state = options.state;
  return getWorkOS().userManagement.getAuthorizationUrl(params);
}

export async function authenticateAuthKitCode(
  code: string,
  requestMeta?: { ipAddress?: string; userAgent?: string },
): Promise<{
  user: AuthUser;
  sealedSession: string;
}> {
  const password = cookiePassword();
  const payload: {
    code: string;
    clientId: string;
    ipAddress?: string;
    userAgent?: string;
    session: { sealSession: true; cookiePassword: string };
  } = {
    code,
    clientId: workosClientId(),
    session: {
      sealSession: true,
      cookiePassword: password,
    },
  };
  if (requestMeta?.ipAddress) payload.ipAddress = requestMeta.ipAddress;
  if (requestMeta?.userAgent) payload.userAgent = requestMeta.userAgent;
  const result = await getWorkOS().userManagement.authenticateWithCode(payload);
  const email = result.user.email?.trim();
  const sealed = result.sealedSession?.trim();
  if (!email) {
    throw new Error("AuthKit did not return a user email");
  }
  if (!result.accessToken || !result.refreshToken) {
    throw new Error("AuthKit authenticate returned no session tokens");
  }
  if (!sealed) {
    throw new Error("AuthKit did not return a sealed session");
  }
  return {
    user: { id: result.user.id, email },
    sealedSession: sealed,
  };
}

export type LoadedSession =
  | { ok: true; user: AuthUser; sealedSession: string }
  | { ok: false; reason: "missing" | "invalid" };

export async function loadAuthSession(sealed: string | undefined | null): Promise<LoadedSession> {
  if (!sealed) return { ok: false, reason: "missing" };
  if (!workosConfigured()) return { ok: false, reason: "invalid" };
  try {
    const session = await getWorkOS().userManagement.loadSealedSession({
      sessionData: sealed,
      cookiePassword: cookiePassword(),
    });
    const auth = await session.authenticate();
    if (auth.authenticated && auth.user.email) {
      return {
        ok: true,
        user: { id: auth.user.id, email: auth.user.email },
        sealedSession: sealed,
      };
    }
    const refreshed = await session.refresh();
    if (refreshed.authenticated && refreshed.user.email && refreshed.sealedSession) {
      return {
        ok: true,
        user: { id: refreshed.user.id, email: refreshed.user.email },
        sealedSession: refreshed.sealedSession,
      };
    }
    return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function logoutUrl(sealed: string | undefined | null, fallback: string): Promise<string> {
  if (!sealed || !workosConfigured()) return fallback;
  try {
    const session = await getWorkOS().userManagement.loadSealedSession({
      sessionData: sealed,
      cookiePassword: cookiePassword(),
    });
    return await session.getLogoutUrl({ returnTo: fallback });
  } catch {
    return fallback;
  }
}

/** Chrome's maximum cookie lifetime. Tokens inside the seal are the real TTL. */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export function sessionCookieOptions(secure: boolean): {
  name: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
} {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: SESSION_COOKIE_MAX_AGE,
  };
}

/** Never invent a cookie from session_id or a raw user blob. */
export function shouldSetSessionCookie(sealedSession: string | null | undefined): sealedSession is string {
  if (!sealedSession || sealedSession.length < 32) return false;
  if (sealedSession.startsWith("cs_")) return false;
  if (sealedSession.startsWith("{") || sealedSession.startsWith("[")) return false;
  return true;
}
