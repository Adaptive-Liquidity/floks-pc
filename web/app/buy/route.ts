import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../lib/auth/cookies";
import { CheckoutNotConfigured, createCheckoutSession } from "../../lib/billing/stripe";
import { openBuyToken, peekBuyToken } from "../../lib/billing/buy-link";

export const runtime = "nodejs";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

/** Confirm page only. Chat previews must not start checkout or use the nonce. */
export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const peeked = await peekBuyToken(token);
  if (!peeked.ok) return NextResponse.json({ error: peeked.reason }, { status: 400 });
  const safe = escapeHtml(token);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Confirm purchase</title></head><body><main><p>Confirm purchase</p><p>Continue to pay for the ${escapeHtml(peeked.payload.plan)} plan. This connects the computer to your Bot.</p><form method="post" action="/buy"><input type="hidden" name="t" value="${safe}"><button type="submit">Continue to pay</button></form></main></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!csrfOk(request, requestOrigin(request.url))) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const form = await request.formData();
  const token = String(form.get("t") ?? "");
  const opened = await openBuyToken(token);
  if (!opened.ok) return NextResponse.json({ error: opened.reason }, { status: 400 });
  const remainingMs = opened.payload.exp - Date.now();
  const expiresAt = remainingMs >= 30 * 60 * 1000 ? Math.floor(opened.payload.exp / 1000) : undefined;
  try {
    const session = await createCheckoutSession({
      request,
      plan: opened.payload.plan,
      email: opened.payload.email,
      ...(expiresAt ? { expiresAt } : {}),
      bindMetadata: {
        oauth_client_id: opened.payload.clientId,
        subject: opened.payload.subject,
        flock: opened.payload.flock,
        bind_nonce: opened.payload.nonce,
      },
    });
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    const message = err instanceof CheckoutNotConfigured ? err.message : "Checkout could not start.";
    return NextResponse.json({ error: "checkout_unavailable", message }, { status: 503 });
  }
}
