import { NextResponse } from "next/server";
import { publicOriginFromRequest } from "../../../lib/auth/callback";
import { authorizationServerMetadata } from "../../../lib/oauth";

export function GET(request: Request): NextResponse {
  return NextResponse.json(authorizationServerMetadata(publicOriginFromRequest(request)));
}
