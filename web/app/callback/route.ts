import { NextResponse } from "next/server";
import {
  callbackAutoPostHtml,
  callbackDestination,
  callbackFailurePath,
  clientIp,
  isAuthPrefetch,
  logAuthKitFailure,
  publicOriginFromRequest,
} from "@/lib/auth/callback";
import { applySessionCookie, csrfOk } from "@/lib/auth/cookies";
import { authenticateAuthKitCode } from "@/lib/auth/workos";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;

function setupRedirect(origin: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, origin), { status: 303 });
  for (const [key, value] of Object.entries(NO_STORE)) {
    response.headers.set(key, value);
  }
  return response;
}

async function finishWithCode(
  request: Request,
  code: string,
  state: string | null,
): Promise<NextResponse> {
  const origin = publicOriginFromRequest(request);
  try {
    const meta: { ipAddress?: string; userAgent?: string } = {};
    const ip = clientIp(request);
    const userAgent = request.headers.get("user-agent");
    if (ip) meta.ipAddress = ip;
    if (userAgent) meta.userAgent = userAgent;
    const auth = await authenticateAuthKitCode(code, meta);
    const dest = callbackDestination(state);
    const response = setupRedirect(origin, dest);
    applySessionCookie(response, auth.sealedSession, request);
    console.info("[authkit] callback sealed session", {
      sealedLength: auth.sealedSession.length,
      dest,
    });
    return response;
  } catch (err) {
    logAuthKitFailure("callback.authenticate", err);
    return setupRedirect(origin, callbackFailurePath(err));
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const sessionId = url.searchParams.get("session_id");
  const error = url.searchParams.get("error");
  const origin = publicOriginFromRequest(request);

  if (!code) {
    if (sessionId) {
      return setupRedirect(origin, `/setup?session_id=${encodeURIComponent(sessionId)}`);
    }
    const kind = error === "access_denied" || error === "expired_token" ? "expired" : "invalid";
    return setupRedirect(origin, `/setup?error=${kind}`);
  }

  if (isAuthPrefetch(request)) {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }

  const html = callbackAutoPostHtml(code, url.searchParams.get("state") ?? "", `${origin}/callback`);
  return new NextResponse(html, {
    status: 200,
    headers: {
      ...NO_STORE,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function POST(request: Request) {
  const origin = publicOriginFromRequest(request);
  if (!csrfOk(request, origin)) {
    logAuthKitFailure("callback.csrf", new Error("Origin mismatch"));
    return setupRedirect(origin, "/setup?error=invalid");
  }
  const form = await request.formData();
  const rawCode = form.get("code");
  const rawState = form.get("state");
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const state = typeof rawState === "string" ? rawState : "";
  if (!code) {
    return setupRedirect(origin, "/setup?error=invalid");
  }
  return finishWithCode(request, code, state);
}
