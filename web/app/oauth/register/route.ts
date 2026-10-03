import { NextResponse } from "next/server";
import { getOauthStore, redirectHostAllowed, registerClient } from "../../../lib/oauth";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "oauth-register"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const record =
    body && typeof body === "object" ? (body as { redirect_uris?: unknown; client_name?: unknown }) : {};
  const redirectUris = Array.isArray(record.redirect_uris)
    ? record.redirect_uris.filter((item): item is string => typeof item === "string")
    : [];
  const allowed = redirectUris.filter((uri) => redirectHostAllowed(uri));
  if (allowed.length === 0) {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const clientName = typeof record.client_name === "string" ? record.client_name : null;
  const client = registerClient(allowed, clientName);
  await getOauthStore().saveClient(client);
  const hosts = allowed.map((uri) => new URL(uri).host);
  console.info(JSON.stringify({ event: "oauth.register", client_id: client.id, hosts }));
  return NextResponse.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
