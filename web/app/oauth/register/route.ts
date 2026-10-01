import { NextResponse } from "next/server";
import { getOauthStore, redirectAllowed, registerClient } from "../../../lib/oauth";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "oauth-register"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const body = (await request.json()) as { redirect_uris?: unknown };
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((item): item is string => typeof item === "string")
    : [];
  if (redirectUris.length === 0) {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const client = registerClient(redirectUris);
  await getOauthStore().saveClient(client);
  return NextResponse.json({ client_id: client.id, redirect_uris: client.redirectUris }, { status: 201 });
}

export { redirectAllowed };
