import { NextResponse } from "next/server";
import { clearSessionCookie, csrfOk, requestOrigin } from "@/lib/auth/cookies";
import { COOKIE_NAME, logoutUrl } from "@/lib/auth/workos";

async function endSession(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request.url);
  if (request.method === "POST" && !csrfOk(request, origin)) {
    return NextResponse.json({ ok: false, message: "Origin mismatch" }, { status: 403 });
  }
  const sealed = request.headers.get("cookie")?.match(/(?:^|; )wos-session=([^;]+)/)?.[1] ?? null;
  const dest = await logoutUrl(sealed, `${origin}/`);
  const response = NextResponse.redirect(dest, { status: 302 });
  clearSessionCookie(response);
  response.cookies.set({ name: COOKIE_NAME, value: "", path: "/", maxAge: 0 });
  return response;
}

export function GET(request: Request) {
  return endSession(request);
}

export function POST(request: Request) {
  return endSession(request);
}
