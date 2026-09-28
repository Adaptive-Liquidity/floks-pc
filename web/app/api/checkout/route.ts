import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "@/lib/auth/cookies";
import { userFromRequest } from "@/lib/auth/request-session";
import { CheckoutNotConfigured, createCheckoutSession } from "@/lib/billing/stripe";
import { isCheckoutPlanId } from "@/lib/billing/catalog";

export const runtime = "nodejs";

async function startCheckout(request: Request, plan: string, quantity: number): Promise<NextResponse> {
  const { user } = await userFromRequest(request);
  if (!user) {
    return NextResponse.redirect(new URL("/signup", request.url), { status: 303 });
  }
  if (!isCheckoutPlanId(plan)) {
    return NextResponse.redirect(new URL("/pricing", request.url), { status: 303 });
  }
  try {
    const session = await createCheckoutSession({
      request,
      plan,
      email: user.email,
      quantity,
    });
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    const message = err instanceof CheckoutNotConfigured ? err.message : "Checkout is not available.";
    console.error("[checkout]", message);
    const dest = new URL("/pricing", request.url);
    dest.searchParams.set("checkout", "error");
    return NextResponse.redirect(dest, { status: 303 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan") ?? "";
  const quantity = Number(url.searchParams.get("quantity") ?? "1");
  return startCheckout(request, plan, quantity);
}

export async function POST(request: Request) {
  if (!csrfOk(request, requestOrigin(request.url))) {
    return NextResponse.json({ ok: false, message: "Origin mismatch" }, { status: 403 });
  }
  const form = await request.formData();
  const plan = String(form.get("plan") ?? "").trim();
  const quantity = Number(form.get("quantity") ?? "1");
  return startCheckout(request, plan, quantity);
}
