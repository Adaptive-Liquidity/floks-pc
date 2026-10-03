/**
 * Tool-level activity history. Metadata only.
 * Coverage is one row per MCP tool call or owner control, not each command
 * inside an exec. This is not a signed or tamper-evident log.
 * Never persist tokens, pair codes, command output, screenshots, cookies,
 * or page contents.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { OperatorEvent, OperatorEventKind } from "../operator/view.js";

export const ACTIVITY_RETENTION_DAYS = 30;
export const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const ACTIVITY_PAGE_MAX = 50;
export const ACTIVITY_PAGE_DEFAULT = 20;
export const ACTIVITY_HISTORY_COVERAGE = "tool" as const;

/** Kinds shown on the owner dashboard. Status polls stay out of this list. */
export const DASHBOARD_EVENT_KINDS = [
  "pair",
  "observe",
  "browser",
  "file",
  "exec",
  "handoff",
  "lifecycle",
  "fail-closed",
  "cleanup",
] as const satisfies readonly OperatorEventKind[];

export type DashboardEventKind = (typeof DASHBOARD_EVENT_KINDS)[number];

export const ACTIVITY_STAGES = ["intent", "outcome", "denial", "emergency"] as const;
export type ActivityStage = (typeof ACTIVITY_STAGES)[number];

export const ACTIVITY_OUTCOMES = ["succeeded", "failed", "denied", "UNCERTAIN"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

/** Dashboard list hides bare intents. Those rows are the reconciliation signal. */
export const ACTIVITY_VISIBLE_STAGES = ["outcome", "denial", "emergency"] as const;

const EMERGENCY_ACTIVITY_OPERATIONS = new Set([
  "pause",
  "stop",
  "suspend",
  "revoke",
  "revoke_capability",
  "revoke_bound",
]);

export function isEmergencyActivityOperation(operation: string): boolean {
  return EMERGENCY_ACTIVITY_OPERATIONS.has(operation);
}

export function isVisibleActivityStage(stage: string | null | undefined): boolean {
  return stage == null || (ACTIVITY_VISIBLE_STAGES as readonly string[]).includes(stage);
}

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Keep a stable code, or replace anything that could carry a secret. */
export function sanitizeActivityErrorCode(code: string | null | undefined): string | null {
  if (code == null || code.length === 0) return null;
  return SAFE_ERROR_CODE.test(code) ? code : "UNSANITIZED";
}

export const ActivityMetadataSchema = z
  .object({
    coverage: z.literal(ACTIVITY_HISTORY_COVERAGE),
    tool: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
    method: z.string().regex(/^[a-z0-9_./-]{1,64}$/).optional(),
    fsOperation: z.string().regex(/^[a-z0-9_]{1,32}$/).optional(),
    actionCount: z.number().int().min(0).max(50).optional(),
    argvCount: z.number().int().min(0).max(64).optional(),
    exitCode: z.number().int().min(-128).max(255).optional(),
    timedOut: z.boolean().optional(),
    effect: z.enum(["none", "occurred"]).optional(),
  })
  .strict();

export type ActivityMetadata = z.infer<typeof ActivityMetadataSchema>;

export const ActivityEventSchema = z.object({
  id: z.string().min(1).max(64),
  at: z.string().min(1).max(64),
  computerId: z.string().min(1).max(80).nullable(),
  birdId: z.string().min(1).max(256).nullable(),
  kind: z.enum([
    "pair",
    "status",
    "observe",
    "browser",
    "file",
    "exec",
    "fail-closed",
    "cleanup",
    "handoff",
    "lifecycle",
  ]),
  operation: z.string().min(1).max(128),
  success: z.boolean(),
  errorCode: z.string().min(1).max(128).nullable(),
  tenantId: z.string().min(1).max(256).nullable().optional(),
  actorId: z.string().min(1).max(256).nullable().optional(),
  ownerId: z.string().min(1).max(256).nullable().optional(),
  requestId: z.string().min(1).max(80).nullable().optional(),
  operationId: z.string().min(1).max(80).nullable().optional(),
  attemptId: z.string().min(1).max(80).nullable().optional(),
  stage: z.enum(ACTIVITY_STAGES).nullable().optional(),
  outcome: z.enum(ACTIVITY_OUTCOMES).nullable().optional(),
  recordedAt: z.string().min(1).max(64).optional(),
  metadata: ActivityMetadataSchema.optional(),
});

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export type ActivityCapacityReason = "missing_table" | "missing_column" | "write_failed";

export class ActivityStoreError extends Error {
  readonly reason: ActivityCapacityReason;

  constructor(reason: ActivityCapacityReason, message: string) {
    super(message);
    this.name = "ActivityStoreError";
    this.reason = reason;
  }
}

const recentAlerts: Array<{ reason: ActivityCapacityReason; at: string }> = [];

/** In-process signal for a missing or failing activity history sink. Not a pager. */
export function noteActivityCapacityAlert(reason: ActivityCapacityReason): void {
  const at = new Date().toISOString();
  recentAlerts.push({ reason, at });
  if (recentAlerts.length > 50) recentAlerts.shift();
  console.error(JSON.stringify({ event: "activity.history.capacity", reason, at }));
}

export function recentActivityCapacityAlerts(): readonly { reason: ActivityCapacityReason; at: string }[] {
  return recentAlerts.slice();
}

export function activityFailureReason(err: unknown): ActivityCapacityReason {
  if (err instanceof ActivityStoreError) return err.reason;
  const code =
    err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : "";
  if (code === "42P01") return "missing_table";
  if (code === "42703") return "missing_column";
  return "write_failed";
}

export interface ActivityAttribution {
  tenantId: string | null;
  actorId: string | null;
  ownerId: string | null;
  requestId: string;
}

export const activityAttribution = new AsyncLocalStorage<ActivityAttribution>();

export interface ActivityPage {
  events: ActivityEvent[];
  nextCursor: string | null;
}

export interface ActivityListOptions {
  cursor?: string | null;
  limit: number;
  kinds?: readonly OperatorEventKind[];
  nowMs?: number;
  tenantId?: string | null;
}

export interface ActivityStore {
  append(event: ActivityEvent): Promise<void>;
  list(computerId: string, opts: ActivityListOptions): Promise<ActivityPage>;
  purgeExpired(nowMs: number): Promise<number>;
}

export function isDashboardEventKind(kind: OperatorEventKind): kind is DashboardEventKind {
  return (DASHBOARD_EVENT_KINDS as readonly string[]).includes(kind);
}

export function encodeActivityCursor(at: string, id: string): string {
  return Buffer.from(`${at}\t${id}`, "utf8").toString("base64url");
}

const ACTIVITY_CURSOR_ID = /^[A-Za-z0-9:_-]{1,64}$/;

/** True only when `value` is a real UTC ISO instant (`Date#toISOString` round-trip). */
export function isRoundTripIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === value;
}

export function decodeActivityCursor(cursor: string): { at: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const tab = raw.indexOf("\t");
    if (tab <= 0) return null;
    const at = raw.slice(0, tab);
    const id = raw.slice(tab + 1);
    if (!isRoundTripIsoTimestamp(at)) return null;
    if (!ACTIVITY_CURSOR_ID.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function paginateActivityEvents(
  events: readonly ActivityEvent[],
  opts: ActivityListOptions,
): ActivityPage {
  const limit = Math.min(ACTIVITY_PAGE_MAX, Math.max(1, opts.limit));
  const kinds = opts.kinds ?? DASHBOARD_EVENT_KINDS;
  const nowMs = opts.nowMs ?? Date.now();
  const cutoff = nowMs - ACTIVITY_RETENTION_MS;
  const cursor = opts.cursor ? decodeActivityCursor(opts.cursor) : null;
  const filtered = events.filter((event) => {
    if (!isVisibleActivityStage(event.stage)) return false;
    if (!kinds.includes(event.kind)) return false;
    if (opts.tenantId && event.tenantId != null && event.tenantId !== opts.tenantId) return false;
    const atMs = Date.parse(event.at);
    if (Number.isFinite(atMs) && atMs < cutoff) return false;
    if (!cursor) return true;
    if (event.at < cursor.at) return true;
    if (event.at === cursor.at && event.id < cursor.id) return true;
    return false;
  });
  filtered.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  const page = filtered.slice(0, limit + 1);
  const extra = page.length > limit;
  const eventsOut = extra ? page.slice(0, limit) : page;
  const last = eventsOut[eventsOut.length - 1];
  return {
    events: eventsOut.map((event) => ({ ...event })),
    nextCursor: extra && last ? encodeActivityCursor(last.at, last.id) : null,
  };
}

export function toActivityEvent(
  event: OperatorEvent & {
    tenantId?: string | null;
    actorId?: string | null;
    ownerId?: string | null;
    requestId?: string | null;
    operationId?: string | null;
    attemptId?: string | null;
    stage?: ActivityStage | null;
    outcome?: ActivityOutcome | null;
    recordedAt?: string;
    metadata?: ActivityMetadata;
  },
): ActivityEvent {
  return ActivityEventSchema.parse({
    id: event.id,
    at: event.at,
    computerId: event.computerId,
    birdId: event.birdId,
    kind: event.kind,
    operation: event.operation,
    success: event.success,
    errorCode: sanitizeActivityErrorCode(event.errorCode),
    ...(event.tenantId !== undefined ? { tenantId: event.tenantId } : {}),
    ...(event.actorId !== undefined ? { actorId: event.actorId } : {}),
    ...(event.ownerId !== undefined ? { ownerId: event.ownerId } : {}),
    ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
    ...(event.operationId !== undefined ? { operationId: event.operationId } : {}),
    ...(event.attemptId !== undefined ? { attemptId: event.attemptId } : {}),
    ...(event.stage !== undefined ? { stage: event.stage } : {}),
    ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
    ...(event.recordedAt !== undefined ? { recordedAt: event.recordedAt } : {}),
    ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
  });
}

export class MemoryActivityStore implements ActivityStore {
  private rows: ActivityEvent[] = [];

  async append(event: ActivityEvent): Promise<void> {
    this.rows.push(ActivityEventSchema.parse(event));
  }

  async list(computerId: string, opts: ActivityListOptions): Promise<ActivityPage> {
    return paginateActivityEvents(
      this.rows.filter((row) => row.computerId === computerId),
      opts,
    );
  }

  async purgeExpired(nowMs: number): Promise<number> {
    const cutoff = nowMs - ACTIVITY_RETENTION_MS;
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => {
      const atMs = Date.parse(row.at);
      return !Number.isFinite(atMs) || atMs >= cutoff;
    });
    return before - this.rows.length;
  }
}

export function activityStoreFromEnv(): ActivityStore {
  return new MemoryActivityStore();
}
