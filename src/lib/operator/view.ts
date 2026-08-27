/**
 * L2 operator console view-models. Metadata only — no tokens, pair codes,
 * screenshots, terminal output, or page contents in the snapshot.
 */

import { workspaceRootForProvider } from "../computers/path.js";
import type {
  CapabilityScope,
  Computer,
  ComputerProviderName,
  ComputerState,
} from "../computers/types.js";

export const OPERATOR_CONSOLE_PATH = "/console";
export const OPERATOR_API_PREFIX = "/operator/v1";
export const OPERATOR_MCP_TOOL_COUNT = 8;
export const OPERATOR_EVENT_CAP = 200;

export type OperatorPairStatus = "paired" | "unpaired" | "pairing";

export type OperatorEventKind =
  | "pair"
  | "status"
  | "observe"
  | "browser"
  | "file"
  | "exec"
  | "fail-closed"
  | "cleanup";

export interface OperatorEvent {
  id: string;
  at: string;
  computerId: string | null;
  birdId: string | null;
  kind: OperatorEventKind;
  operation: string;
  success: boolean;
  errorCode: string | null;
}

export interface OperatorCost {
  metered: false;
  note: string;
}

export interface OperatorAccessibility {
  source: string;
  nodeCount: number;
  rootRole: string | null;
  rootName: string | null;
}

export interface OperatorObserveResult {
  screenWidth: number;
  screenHeight: number;
  activeWindow?: string;
  hasScreenshot: boolean;
  screenshotBase64?: string;
  accessibility: OperatorAccessibility;
}

export interface OperatorComputerView {
  id: string;
  birdId: string;
  flockId: string;
  headline: string;
  pairStatus: OperatorPairStatus;
  state: ComputerState;
  lifecycleLabel: string;
  provider: ComputerProviderName;
  providerRef: string | null;
  lastAction: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  scopes: CapabilityScope[];
  capabilityExpiresAt: string | null;
  workspaceRoot: string;
  runtimeMs: number;
  cost: OperatorCost;
  warnings: string[];
}

export interface OperatorSnapshot {
  computers: OperatorComputerView[];
  events: OperatorEvent[];
  mcpToolCount: typeof OPERATOR_MCP_TOOL_COUNT;
  durableStore: boolean;
  provider: ComputerProviderName;
  warnings: string[];
}

export function lifecycleLabel(state: ComputerState): string {
  if (state === "paused") return "sleeping";
  if (state === "ready") return "running";
  return state;
}

export function summarizeAccessibility(raw: unknown): OperatorAccessibility {
  const empty: OperatorAccessibility = {
    source: "none",
    nodeCount: 0,
    rootRole: null,
    rootName: null,
  };
  if (raw === null || raw === undefined) return empty;
  if (typeof raw !== "object" || Array.isArray(raw)) return empty;
  const rec = raw as Record<string, unknown>;
  const nodesRaw = rec.nodes;
  let nodeCount = 0;
  let rootRole: string | null = null;
  let rootName: string | null = null;
  if (typeof nodesRaw === "number" && Number.isFinite(nodesRaw)) {
    nodeCount = Math.max(0, Math.floor(nodesRaw));
  } else if (Array.isArray(nodesRaw)) {
    nodeCount = nodesRaw.length;
    const first = nodesRaw[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const node = first as Record<string, unknown>;
      if (typeof node.role === "string") rootRole = node.role;
      if (typeof node.name === "string") rootName = node.name;
    }
  }
  const source =
    typeof rec.source === "string" && rec.source.length > 0
      ? rec.source
      : nodeCount > 0 || nodesRaw !== undefined
        ? "unknown"
        : "none";
  return { source, nodeCount, rootRole, rootName };
}

export function computerWarnings(input: {
  provider: ComputerProviderName;
  durableStore: boolean;
}): string[] {
  const warnings = [
    "click_element stays fail-closed until L5. This console will not guess clicks.",
    "Takeover / VNC is not in this console.",
    "Runtime cost is not metered yet (billing is L7).",
  ];
  if (input.provider === "fake") {
    warnings.push("FakeProvider is not Agent Computer proof.");
  }
  if (!input.durableStore) {
    warnings.push("Control-plane is in-memory. Private beta needs durable records.");
  }
  return warnings;
}

export function buildOperatorComputerView(
  computer: Computer,
  extras: {
    pairStatus: OperatorPairStatus;
    scopes: readonly CapabilityScope[];
    capabilityExpiresAt: Date | null;
    lastAction: string | null;
    durableStore: boolean;
  },
): OperatorComputerView {
  const cost: OperatorCost = {
    metered: false,
    note: "Runtime cost is not metered yet (billing is L7).",
  };
  const view: OperatorComputerView = {
    id: computer.id,
    birdId: computer.birdId,
    flockId: computer.flockId,
    headline: "This bot has this computer",
    pairStatus: extras.pairStatus,
    state: computer.state,
    lifecycleLabel: lifecycleLabel(computer.state),
    provider: computer.provider,
    providerRef: computer.providerRef,
    lastAction: extras.lastAction,
    lastActiveAt: computer.lastActiveAt ? computer.lastActiveAt.toISOString() : null,
    createdAt: computer.createdAt.toISOString(),
    scopes: [...extras.scopes],
    capabilityExpiresAt: extras.capabilityExpiresAt
      ? extras.capabilityExpiresAt.toISOString()
      : null,
    workspaceRoot: workspaceRootForProvider(computer.provider),
    runtimeMs: Math.max(0, Date.now() - computer.createdAt.getTime()),
    cost,
    warnings: computerWarnings({
      provider: computer.provider,
      durableStore: extras.durableStore,
    }),
  };
  return view;
}
