import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  void request.nextUrl.pathname;
  const response = NextResponse.next();
  response.headers.set("Referrer-Policy", "same-origin");
  if (process.env.SITE_INDEXABLE !== "1") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
