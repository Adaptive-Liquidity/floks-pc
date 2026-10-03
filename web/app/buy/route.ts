import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../lib/auth/cookies";
import { checkoutDisabled } from "../../lib/billing/catalog";
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Confirm purchase</title><style>body{margin:0;background:#050505;color:#fff;font-family:Manrope,ui-sans-serif,sans-serif}main{max-width:36rem;margin:0 auto;padding:4rem 1.5rem}p{line-height:1.6;color:#a1a1aa}p:first-child{color:#fff;letter-spacing:.08em;text-transform:uppercase;font-size:.8rem}button{margin-top:1.5rem;background:#fff;color:#000;border:0;border-radius:9999px;padding:.75rem 1.25rem;font-family:ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}</style></head><body><main><p>Confirm purchase</p><p>Continue to pay for the ${escapeHtml(peeked.payload.plan)} plan. Pricing to be confirmed. This connects the computer to your Bot.</p><form method="post" action="/buy"><input type="hidden" name="t" value="${safe}"><button type="submit">Continue to pay</button></form></main></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!csrfOk(request, requestOrigin(request.url))) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (checkoutDisabled()) {
    return NextResponse.json({ error: "checkout_disabled" }, { status: 503 });
  }
  const form = await request.formData();
  const token = String(form.get("t") ?? "");
  const opened = await openBuyToken(token);
  if (!opened.ok) return NextResponse.json({ error: opened.reason }, { status: 400 });
  try {
    const session = await createCheckoutSession({
      request,
      plan: opened.payload.plan,
      email: opened.payload.email,
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
