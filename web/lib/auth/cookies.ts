import { NextResponse } from "next/server";
import { COOKIE_NAME, sessionCookieOptions, shouldSetSessionCookie } from "./workos";

export function applySessionCookie(
  response: NextResponse,
  sealedSession: string | null | undefined,
  requestUrl: string,
): NextResponse {
  if (!shouldSetSessionCookie(sealedSession)) return response;
  const secure = requestUrl.startsWith("https://");
  const flags = sessionCookieOptions(secure);
  response.cookies.set({
    name: flags.name,
    value: sealedSession,
    httpOnly: flags.httpOnly,
    sameSite: flags.sameSite,
    path: flags.path,
    secure: flags.secure,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function requestOrigin(url: string): string {
  return new URL(url).origin;
}

export function csrfOk(request: Request, origin: string): boolean {
  const header = request.headers.get("origin");
  if (!header) return true;
  return header === origin;
}
