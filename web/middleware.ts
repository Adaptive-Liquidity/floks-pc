import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const path = request.nextUrl.pathname;
  response.headers.set("Referrer-Policy", "same-origin");
  if (process.env.SITE_INDEXABLE !== "1") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (path.startsWith("/oauth") || path === "/setup" || path.startsWith("/setup/")) {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("X-Frame-Options", "DENY");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
