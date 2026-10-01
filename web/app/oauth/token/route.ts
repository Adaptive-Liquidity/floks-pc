import { NextResponse } from "next/server";
import { exchangeCode } from "../../../lib/oauth";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "oauth-token"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  let code = "";
  let verifier = "";
  let clientId = "";
  let redirectUri = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      code?: string;
      code_verifier?: string;
      client_id?: string;
      redirect_uri?: string;
    };
    code = body.code ?? "";
    verifier = body.code_verifier ?? "";
    clientId = body.client_id ?? "";
    redirectUri = body.redirect_uri ?? "";
  } else {
    const form = await request.formData();
    code = String(form.get("code") ?? "");
    verifier = String(form.get("code_verifier") ?? "");
    clientId = String(form.get("client_id") ?? "");
    redirectUri = String(form.get("redirect_uri") ?? "");
  }
  const exchanged = await exchangeCode({ code, verifier, clientId, redirectUri });
  if ("error" in exchanged) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  return NextResponse.json({
    access_token: exchanged.token,
    token_type: "Bearer",
    expires_in: 3600,
  });
}
