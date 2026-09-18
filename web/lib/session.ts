import { previewEnabled } from "./preview";
import type { DeskRecord, DeskState, GateState, SeatSession, SetupView } from "./types";
import { DESK_STATES } from "./types";

function firstQuery(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return null;
}

export function gateFromSearch(search: {
  session_id?: string | string[] | undefined;
  error?: string | string[] | undefined;
  link?: string | string[] | undefined;
}): { gate: GateState; sessionId: string | null } {
  const sessionId = firstQuery(search.session_id);
  const error = (firstQuery(search.error) ?? firstQuery(search.link) ?? "").toLowerCase();
  if (error === "expired") return { gate: "expired", sessionId };
  if (error === "invalid") return { gate: "invalid", sessionId };
  if (sessionId) return { gate: "just_paid", sessionId };
  return { gate: "cold", sessionId: null };
}

function isDeskState(value: string): value is DeskState {
  return (DESK_STATES as readonly string[]).includes(value);
}

const PREVIEW_ALIASES: Record<string, DeskState | "past_due" | "zero_seats" | "webhook"> = {
  unused: "unused",
  pairing: "pairing",
  provisioning: "provisioning",
  running: "running",
  sleeping: "sleeping",
  "hours-empty": "hours_empty",
  hours_empty: "hours_empty",
  "shut-down": "shut_down",
  shut_down: "shut_down",
  failed: "failed",
  past_due: "past_due",
  "zero-seats": "zero_seats",
  webhook: "webhook",
};

function deskRecord(state: DeskState, pending: boolean): DeskRecord {
  return {
    id: "preview-desk",
    state,
    userCode: pending ? "ABCD-EFGH" : null,
    pendingRequest: pending,
    pairKeyId: pending ? "preview-pair" : null,
    hoursUsed: 4,
    hoursIncluded: 25,
    computerId: "preview-computer",
  };
}

/** Dev-only fixture. Public UI must call this only when previewEnabled(). */
export function previewSession(name: string): SeatSession | null {
  const key = PREVIEW_ALIASES[name];
  if (!key) return null;
  const desk = deskRecord("unused", true);
  const base: SeatSession = {
    authenticated: true,
    billingEmail: "billing@example.test",
    plan: "desk",
    periodLabel: "Sep 1 – Oct 1",
    flockStatus: "ok",
    seats: 1,
    pluginAllowed: true,
    webhookPending: false,
    desk,
    desks: [desk],
    hoursUsed: 4,
    hoursIncluded: 25,
    portalReady: true,
    revealedPairCode: null,
  };
  if (key === "past_due") {
    return { ...base, flockStatus: "past_due" };
  }
  if (key === "zero_seats") {
    return {
      ...base,
      seats: 0,
      desk: null,
      desks: [],
      plan: null,
      periodLabel: null,
      hoursUsed: null,
      hoursIncluded: null,
    };
  }
  if (key === "webhook") {
    return {
      ...base,
      seats: 0,
      desk: null,
      desks: [],
      webhookPending: true,
    };
  }
  if (isDeskState(key)) {
    const pending = key === "unused" || key === "pairing";
    const next = deskRecord(key, pending);
    return { ...base, desk: next, desks: [next] };
  }
  return base;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseDesk(raw: unknown): DeskRecord | null {
  const deskRaw = asRecord(raw);
  if (!deskRaw) return null;
  const stateRaw = asString(deskRaw.state) ?? asString(deskRaw.status);
  if (!stateRaw || !isDeskState(stateRaw)) return null;
  return {
    id: asString(deskRaw.id) ?? "desk",
    state: stateRaw,
    userCode: asString(deskRaw.userCode) ?? asString(deskRaw.user_code),
    pendingRequest: asBoolean(deskRaw.pendingRequest) ?? asBoolean(deskRaw.pending) ?? false,
    pairKeyId: asString(deskRaw.pairKeyId) ?? asString(deskRaw.pair_key_id),
    hoursUsed: asNumber(deskRaw.hoursUsed) ?? asNumber(deskRaw.hours_used),
    hoursIncluded: asNumber(deskRaw.hoursIncluded) ?? asNumber(deskRaw.hours_included),
    computerId: asString(deskRaw.computerId) ?? asString(deskRaw.computer_id),
  };
}

/** Parse a live /setup JSON body. Never invent a cookie. */
export function parseSeatSession(raw: unknown): SeatSession | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const email = asString(obj.billingEmail) ?? asString(obj.billing_email);
  if (!email) return null;
  const planRaw = asString(obj.plan);
  const plan =
    planRaw === "spark" || planRaw === "desk" || planRaw === "shift" ? planRaw : null;
  const desksRaw = obj.desks;
  const desks: DeskRecord[] = [];
  if (Array.isArray(desksRaw)) {
    for (const item of desksRaw) {
      const parsed = parseDesk(item);
      if (parsed) desks.push(parsed);
    }
  }
  const desk = parseDesk(obj.desk) ?? desks[0] ?? null;
  if (desk && desks.length === 0) desks.push(desk);
  return {
    authenticated: true,
    billingEmail: email,
    plan,
    periodLabel: asString(obj.periodLabel) ?? asString(obj.period),
    flockStatus: asString(obj.flockStatus) === "past_due" || asString(obj.flock_status) === "past_due"
      ? "past_due"
      : "ok",
    seats: asNumber(obj.seats) ?? (desk ? 1 : 0),
    pluginAllowed: asBoolean(obj.pluginAllowed) ?? asBoolean(obj.plugin_allowed) ?? false,
    webhookPending: asBoolean(obj.webhookPending) ?? asBoolean(obj.webhook_pending) ?? false,
    desk,
    desks,
    hoursUsed: asNumber(obj.hoursUsed) ?? asNumber(obj.hours_used),
    hoursIncluded: asNumber(obj.hoursIncluded) ?? asNumber(obj.hours_included),
    portalReady: asBoolean(obj.portalReady) ?? true,
    revealedPairCode: asString(obj.revealedPairCode) ?? asString(obj.revealed_pair_code),
  };
}

export async function loadSetupView(search: {
  session_id?: string | string[] | undefined;
  error?: string | string[] | undefined;
  link?: string | string[] | undefined;
  preview?: string | string[] | undefined;
}): Promise<SetupView> {
  const previewName = firstQuery(search.preview);
  if (previewName && previewEnabled()) {
    const session = previewSession(previewName);
    if (session) return { kind: "desk", session, preview: true };
  }

  const { gate, sessionId } = gateFromSearch(search);
  return { kind: "gate", gate, sessionId };
}

export function queryFirst(value: string | string[] | undefined): string | null {
  return firstQuery(value);
}
