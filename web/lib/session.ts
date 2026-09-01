import type { DeskState, GateState, SeatSession, SetupView } from "./types";
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

export function previewSession(name: string): SeatSession | null {
  const key = PREVIEW_ALIASES[name];
  if (!key) return null;
  const base: SeatSession = {
    authenticated: true,
    billingEmail: "billing@example.test",
    plan: "desk",
    periodLabel: "Sep 1 – Oct 1",
    flockStatus: "ok",
    seats: 1,
    pluginAllowed: true,
    webhookPending: false,
    desk: {
      state: "unused",
      userCode: "ABCD-EFGH",
      pendingRequest: true,
    },
    hoursUsed: 4,
    hoursIncluded: 25,
    portalReady: true,
  };
  if (key === "past_due") {
    return { ...base, flockStatus: "past_due" };
  }
  if (key === "zero_seats") {
    return {
      ...base,
      seats: 0,
      desk: null,
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
      webhookPending: true,
    };
  }
  if (isDeskState(key)) {
    const pending = key === "unused" || key === "pairing";
    return {
      ...base,
      desk: {
        state: key,
        userCode: pending ? "ABCD-EFGH" : null,
        pendingRequest: pending,
      },
    };
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

/** Parse a live /setup JSON body if the host ever returns one. Never invent a cookie. */
export function parseSeatSession(raw: unknown): SeatSession | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const email = asString(obj.billingEmail) ?? asString(obj.billing_email);
  if (!email) return null;
  const planRaw = asString(obj.plan);
  const plan =
    planRaw === "spark" || planRaw === "desk" || planRaw === "shift" ? planRaw : null;
  const deskRaw = asRecord(obj.desk);
  const stateRaw = deskRaw ? asString(deskRaw.state) ?? asString(deskRaw.status) : null;
  const desk =
    deskRaw && stateRaw && isDeskState(stateRaw)
      ? {
          state: stateRaw,
          userCode: asString(deskRaw.userCode) ?? asString(deskRaw.user_code),
          pendingRequest: asBoolean(deskRaw.pendingRequest) ?? asBoolean(deskRaw.pending) ?? false,
        }
      : null;
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
    hoursUsed: asNumber(obj.hoursUsed) ?? asNumber(obj.hours_used),
    hoursIncluded: asNumber(obj.hoursIncluded) ?? asNumber(obj.hours_included),
    portalReady: asBoolean(obj.portalReady) ?? true,
  };
}

export async function loadSetupView(search: {
  session_id?: string | string[] | undefined;
  error?: string | string[] | undefined;
  link?: string | string[] | undefined;
  preview?: string | string[] | undefined;
}): Promise<SetupView> {
  const previewName = firstQuery(search.preview);
  if (previewName) {
    const session = previewSession(previewName);
    if (session) return { kind: "desk", session, preview: true };
  }

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/setup", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const session = parseSeatSession(await res.json());
          if (session) return { kind: "desk", session, preview: false };
        }
      }
    } catch {
      /* same-origin session only; never mint from session_id */
    }
  }

  const { gate, sessionId } = gateFromSearch(search);
  return { kind: "gate", gate, sessionId };
}
