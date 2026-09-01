export const DESK_STATES = [
  "unused",
  "pairing",
  "provisioning",
  "running",
  "sleeping",
  "hours_empty",
  "shut_down",
  "failed",
] as const;

export type DeskState = (typeof DESK_STATES)[number];

export const GATE_STATES = ["cold", "just_paid", "expired", "invalid"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const OAUTH_STATES = [
  "loading",
  "ready",
  "invalid_client",
  "already_allowed",
  "error",
] as const;
export type OauthUiState = (typeof OAUTH_STATES)[number];

export type PlanId = "spark" | "desk" | "shift";

export type SeatSession = {
  authenticated: true;
  billingEmail: string;
  plan: PlanId | null;
  periodLabel: string | null;
  flockStatus: "ok" | "past_due";
  seats: number;
  pluginAllowed: boolean;
  webhookPending: boolean;
  desk: {
    state: DeskState;
    userCode: string | null;
    pendingRequest: boolean;
  } | null;
  hoursUsed: number | null;
  hoursIncluded: number | null;
  portalReady: boolean;
};

export type SetupView =
  | { kind: "gate"; gate: GateState; sessionId: string | null }
  | { kind: "desk"; session: SeatSession; preview: boolean };
