import { NextResponse } from "next/server";
import { exchangeCode, refreshAccess } from "../../../lib/oauth";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../lib/rate-limit";

type TokenRequest = {
  grant_type: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  refreshToken: string;
};

async function readTokenRequest(request: Request): Promise<TokenRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      grant_type?: string;
      code?: string;
      code_verifier?: string;
      client_id?: string;
      redirect_uri?: string;
      refresh_token?: string;
    };
    return {
      grant_type: body.grant_type ?? "authorization_code",
      code: body.code ?? "",
      verifier: body.code_verifier ?? "",
      clientId: body.client_id ?? "",
      redirectUri: body.redirect_uri ?? "",
      refreshToken: body.refresh_token ?? "",
    };
  }
  const form = await request.formData();
  return {
    grant_type: String(form.get("grant_type") ?? "authorization_code"),
    code: String(form.get("code") ?? ""),
    verifier: String(form.get("code_verifier") ?? ""),
    clientId: String(form.get("client_id") ?? ""),
    redirectUri: String(form.get("redirect_uri") ?? ""),
    refreshToken: String(form.get("refresh_token") ?? ""),
  };
}

function issued(token: string, refresh: string): NextResponse {
  return NextResponse.json({
    access_token: token,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: 3600,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "oauth-token"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const body = await readTokenRequest(request);
  if (body.grant_type === "refresh_token") {
    const refreshed = await refreshAccess(body.refreshToken, body.clientId);
    if ("error" in refreshed) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    return issued(refreshed.token, refreshed.refresh);
  }
  const exchanged = await exchangeCode({
    code: body.code,
    verifier: body.verifier,
    clientId: body.clientId,
    redirectUri: body.redirectUri,
  });
  if ("error" in exchanged) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  return issued(exchanged.token, exchanged.refresh);
}
