import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}
