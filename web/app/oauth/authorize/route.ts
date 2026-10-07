import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../../lib/auth/cookies";
import { userFromRequest } from "../../../lib/auth/request-session";
import { listAllowComputers } from "../../../lib/billing/allow-computers";
import { flockIdForEmail } from "../../../lib/desks/runtime";
import { getOauthStore, issueCode, redirectAllowed } from "../../../lib/oauth";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../lib/rate-limit";

function consentUrl(request: Request): URL {
  const url = new URL(request.url);
  return new URL(`/oauth/consent?${url.searchParams.toString()}`, url.origin);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "oauth-authorize"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const url = new URL(request.url);
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("application/json")) {
    return NextResponse.redirect(new URL(`/oauth/consent?${url.searchParams.toString()}`, url.origin), { status: 303 });
  }
  const clientId = url.searchParams.get("client_id") ?? "";
  const client = await getOauthStore().getClient(clientId);
  if (!client) return NextResponse.json({ error: "invalid_client" });
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  if (!redirectAllowed(client, redirectUri)) return NextResponse.json({ error: "invalid_client" });
  const { user } = await userFromRequest(request);
  if (!user) return NextResponse.json({ status: "signed_out" });
  if (process.env.FLOK_PER_BOT_KEYS === "true") {
    return NextResponse.json({ status: "ready", account_only: true, client_name: client.clientName });
  }
  const computers = await listAllowComputers(user.email);
  if (computers.length > 0) {
    return NextResponse.json({ status: "ready", client_name: client.clientName, computers });
  }
  return NextResponse.json({ status: "ready", needs_computer: true, client_name: client.clientName });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "oauth-authorize"))) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const origin = requestOrigin(request.url);
  if (!csrfOk(request, origin)) return NextResponse.json({ ok: false }, { status: 403 });
  const form = await request.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const challenge = String(form.get("code_challenge") ?? "");
  const client = await getOauthStore().getClient(clientId);
  if (!client || !redirectAllowed(client, redirectUri) || !challenge) {
    return NextResponse.redirect(new URL("/", origin), { status: 303 });
  }
  const { user } = await userFromRequest(request);
  if (!user) {
    const back = new URL("/login", origin);
    back.searchParams.set("return", `${new URL(request.url).pathname}${new URL(request.url).search}`);
    return NextResponse.redirect(back, { status: 303 });
  }
  const perBot = process.env.FLOK_PER_BOT_KEYS === "true";
  const computers = perBot ? [] : await listAllowComputers(user.email);
  const picked = String(form.get("computer_id") ?? "");
  let computerId: string | null = null;
  if (!perBot && computers.length > 0) {
    const chosen = picked || (computers.length === 1 ? computers[0]?.id ?? "" : "");
    if (!chosen || !computers.some((row) => row.id === chosen)) {
      return NextResponse.redirect(consentUrl(request), { status: 303 });
    }
    if (await getOauthStore().computerHeldByOtherSubject(chosen, user.id)) {
      return NextResponse.redirect(consentUrl(request), { status: 303 });
    }
    computerId = chosen;
  }
  const code = await issueCode({
    clientId,
    redirectUri,
    challenge,
    subject: user.id,
    flock: flockIdForEmail(user.email),
    email: user.email,
    computerId,
  });
  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  const state = String(form.get("state") ?? "");
  if (state) dest.searchParams.set("state", state);
  return NextResponse.redirect(dest, { status: 303 });
}
