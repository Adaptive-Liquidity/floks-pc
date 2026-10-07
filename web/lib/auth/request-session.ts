import { COOKIE_NAME, loadAuthSession, type AuthUser } from "./workos";

export async function userFromRequest(request: Request): Promise<{
  user: AuthUser | null;
  sealedSession: string | null;
}> {
  // Tests only. Production ignores this header, and it stays off unless STAX_TEST_AUTH=1.
  if (process.env.NODE_ENV !== "production") {
    const raw = request.headers.get("x-stax-test-user");
    if (raw && process.env.STAX_TEST_AUTH === "1") {
      try {
        const parsed = JSON.parse(raw) as { id?: unknown; email?: unknown };
        if (typeof parsed.id === "string" && typeof parsed.email === "string" && parsed.id && parsed.email) {
          return { user: { id: parsed.id, email: parsed.email }, sealedSession: null };
        }
      } catch {
        return { user: null, sealedSession: null };
      }
      return { user: null, sealedSession: null };
    }
  }
  const match = request.headers.get("cookie")?.match(/(?:^|; )wos-session=([^;]+)/);
  const sealed = match?.[1] ? decodeURIComponent(match[1]) : null;
  const loaded = await loadAuthSession(sealed);
  if (!loaded.ok) return { user: null, sealedSession: sealed };
  return { user: loaded.user, sealedSession: loaded.sealedSession };
}

export { COOKIE_NAME };
