import { NextResponse } from "next/server";
import { publicOriginFromRequest } from "../../../lib/auth/callback";
import { protectedResourceMetadata } from "../../../lib/oauth";

export function GET(request: Request): NextResponse {
  return NextResponse.json(protectedResourceMetadata(publicOriginFromRequest(request)));
}
