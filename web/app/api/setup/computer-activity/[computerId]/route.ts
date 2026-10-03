import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ACTIVITY_RETENTION_DAYS,
  decodeActivityCursor,
} from "../../../../../../src/lib/computers/index";
import { requireOwnedComputer } from "../../../../../lib/computers/owner";
import { getComputerService } from "../../../../../lib/desks/runtime";
import { clientKey, rateLimitedBody, takeRateLimit } from "../../../../../lib/rate-limit";

const QuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ computerId: string }> },
): Promise<NextResponse> {
  if (!takeRateLimit(clientKey(request, "computer-activity-get"), 30)) {
    return NextResponse.json(rateLimitedBody(), { status: 429 });
  }
  const { computerId } = await context.params;
  const owned = await requireOwnedComputer(request, computerId);
  if (!owned.ok) return NextResponse.json(owned.body, { status: owned.status });
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Invalid page." }, { status: 400 });
  }
  if (parsed.data.cursor && !decodeActivityCursor(parsed.data.cursor)) {
    return NextResponse.json({ ok: false, message: "Invalid page." }, { status: 400 });
  }
  const page = await (await getComputerService()).listActivityEvents(owned.computerId, {
    cursor: parsed.data.cursor ?? null,
    limit: parsed.data.limit ?? 20,
  });
  return NextResponse.json({
    ok: true,
    events: page.events,
    nextCursor: page.nextCursor,
    retentionDays: ACTIVITY_RETENTION_DAYS,
  });
}
