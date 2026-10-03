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

export const GATE_STATES = ["cold", "just_paid", "expired", "invalid", "workos_env"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const OAUTH_STATES = [
  "loading",
  "ready",
  "invalid_client",
  "already_allowed",
  "error",
  "signed_out",
  "no_plan",
] as const;
export type OauthUiState = (typeof OAUTH_STATES)[number];

export type PlanId = "personal" | "pro" | "team";

export type DeskRecord = {
  id: string;
  state: DeskState;
  userCode: string | null;
  pendingRequest: boolean;
  pairKeyId: string | null;
  hoursUsed: number | null;
  hoursIncluded: number | null;
  computerId: string | null;
  botName: string | null;
  lastUsedLabel: string | null;
};

export type SeatSession = {
  authenticated: true;
  billingEmail: string;
  plan: PlanId | null;
  periodLabel: string | null;
  flockStatus: "ok" | "past_due";
  seats: number;
  pluginAllowed: boolean;
  webhookPending: boolean;
  desk: DeskRecord | null;
  desks: DeskRecord[];
  hoursUsed: number | null;
  hoursIncluded: number | null;
  portalReady: boolean;
  revealedPairCode: string | null;
  canceledHold: boolean;
  reconnectBot: boolean;
};

export type SetupView =
  | { kind: "gate"; gate: GateState; sessionId: string | null }
  | { kind: "desk"; session: SeatSession; preview: boolean };
