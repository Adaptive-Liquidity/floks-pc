import { randomBytes } from "node:crypto";
import {
  ActivityEventSchema,
  activityFailureReason,
  noteActivityCapacityAlert,
  sanitizeActivityErrorCode,
} from "../../src/lib/computers/index";
import { PostgresActivityStore } from "./store/activity-pg";

/**
 * Durable denial for an MCP call rejected before ComputerService runs.
 * A missing DATABASE_URL in production raises a capacity alert and does not
 * pretend the denial was stored. The rejection response is still returned.
 */
export async function recordRejectedMcpCall(input: {
  operation: string;
  errorCode: string;
  preAuth: boolean;
  tenantId?: string | null;
  actorId?: string | null;
  ownerId?: string | null;
}): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      noteActivityCapacityAlert("write_failed");
    }
    return;
  }
  const now = new Date().toISOString();
  const id = randomBytes(16).toString("hex");
  try {
    await new PostgresActivityStore(databaseUrl).append(
      ActivityEventSchema.parse({
        id,
        at: now,
        computerId: null,
        birdId: null,
        kind: "fail-closed",
        operation: input.operation,
        success: false,
        errorCode: sanitizeActivityErrorCode(input.errorCode) ?? "UNSANITIZED",
        tenantId: input.preAuth ? null : (input.tenantId ?? null),
        actorId: input.preAuth ? null : (input.actorId ?? null),
        ownerId: input.preAuth ? null : (input.ownerId ?? null),
        requestId: randomBytes(16).toString("hex"),
        operationId: randomBytes(16).toString("hex"),
        attemptId: randomBytes(16).toString("hex"),
        stage: "denial",
        outcome: "denied",
        recordedAt: now,
        metadata: { coverage: "tool" },
      }),
    );
  } catch (err) {
    noteActivityCapacityAlert(activityFailureReason(err));
  }
}
