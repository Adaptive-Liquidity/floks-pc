/**
 * Owner-dashboard activity events. Metadata only.
 * Never persist tokens, pair codes, command output, screenshots, cookies,
 * or page contents.
 */

import { z } from "zod";
import type { OperatorEvent, OperatorEventKind } from "../operator/view.js";

export const ACTIVITY_RETENTION_DAYS = 30;
export const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const ACTIVITY_PAGE_MAX = 50;
export const ACTIVITY_PAGE_DEFAULT = 20;

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
});

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export interface ActivityPage {
  events: ActivityEvent[];
  nextCursor: string | null;
}

export interface ActivityListOptions {
  cursor?: string | null;
  limit: number;
  kinds?: readonly OperatorEventKind[];
  nowMs?: number;
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
    if (!kinds.includes(event.kind)) return false;
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

export function toActivityEvent(event: OperatorEvent): ActivityEvent {
  return ActivityEventSchema.parse({
    id: event.id,
    at: event.at,
    computerId: event.computerId,
    birdId: event.birdId,
    kind: event.kind,
    operation: event.operation,
    success: event.success,
    errorCode: event.errorCode,
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
