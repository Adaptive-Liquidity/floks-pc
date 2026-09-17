import { COOKIE_NAME, loadAuthSession, type AuthUser } from "./workos";

export async function userFromRequest(request: Request): Promise<{
  user: AuthUser | null;
  sealedSession: string | null;
}> {
  const match = request.headers.get("cookie")?.match(/(?:^|; )wos-session=([^;]+)/);
  const sealed = match?.[1] ? decodeURIComponent(match[1]) : null;
  const loaded = await loadAuthSession(sealed);
  if (!loaded.ok) return { user: null, sealedSession: sealed };
  return { user: loaded.user, sealedSession: loaded.sealedSession };
}

export { COOKIE_NAME };
