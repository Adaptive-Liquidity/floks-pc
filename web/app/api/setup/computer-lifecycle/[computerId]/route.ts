import { NextResponse } from "next/server";
import { csrfOk, requestOrigin } from "../../../../../lib/auth/cookies";
import {
  LifecycleActionSchema,
  lifecycleFailure,
  ownerComputerPayload,
  requireOwnedComputer,
  runOwnerLifecycleAction,
} from "../../../../../lib/computers/owner";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../../../lib/rate-limit";

export async function GET(
  request: Request,
  context: { params: Promise<{ computerId: string }> },
): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "computer-lifecycle-get"), 30)) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const { computerId } = await context.params;
  const owned = await requireOwnedComputer(request, computerId);
  if (!owned.ok) return NextResponse.json(owned.body, { status: owned.status });
  return NextResponse.json({ ok: true, ...ownerComputerPayload(owned.computer) });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ computerId: string }> },
): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "computer-lifecycle-post"), 20)) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  if (!csrfOk(request, requestOrigin(request.url))) {
    return NextResponse.json({ ok: false, message: "Origin mismatch" }, { status: 403 });
  }
  const { computerId } = await context.params;
  const owned = await requireOwnedComputer(request, computerId);
  if (!owned.ok) return NextResponse.json(owned.body, { status: owned.status });
  let body: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) body = await request.json();
    else {
      const form = await request.formData();
      body = {
        action: String(form.get("action") ?? ""),
        confirmRebuild: form.get("confirm_rebuild") === "true",
      };
    }
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid body." }, { status: 400 });
  }
  const parsed = LifecycleActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }
  try {
    const computer = await runOwnerLifecycleAction(
      owned.computerId,
      parsed.data.action,
      parsed.data.confirmRebuild === true,
    );
    return NextResponse.json({ ok: true, ...ownerComputerPayload(computer) });
  } catch (err) {
    const failure = lifecycleFailure(err);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
