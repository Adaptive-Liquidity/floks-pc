/**
 * L1: Agent Computer blueprints must be interactive.
 * Generic compute-only DnD is not an Agent Computer.
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_RUNLOOP_BLUEPRINT } from "./runloop-client.js";
import { DEFAULT_INTERACTIVE_BLUEPRINT } from "./runloop-interactive.js";
import { ComputerError } from "../errors.js";

export class InteractiveBlueprintRequired extends ComputerError {
  constructor(detail: string) {
    super("INTERACTIVE_BLUEPRINT_REQUIRED", detail);
    this.name = "InteractiveBlueprintRequired";
  }
}

export function allowComputeOnlyBlueprint(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isGenericComputeBlueprint(name: string): boolean {
  const n = name.trim();
  return n === DEFAULT_RUNLOOP_BLUEPRINT || n === "runloop/universal-ubuntu-24.04-x86_64-dnd";
}

export function isInteractiveBlueprintName(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const n = name.trim();
  if (!n) return false;
  if (isGenericComputeBlueprint(n)) return false;
  const extra = env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT?.trim();
  if (n === DEFAULT_INTERACTIVE_BLUEPRINT) return true;
  if (extra && n === extra) return true;
  return n.includes("interactive") || n.includes("flok-runloop");
}

/**
 * Blueprint for an Agent Computer. Fails closed on missing/generic DnD
 * unless FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY is set (C3A live compute tests only).
 */
export function newFloksRunId(): string {
  return randomUUID();
}

export function buildAgentComputerLabels(
  spec: { birdId: string; flockId: string },
  opts?: { ownerId?: string | null; workspaceId?: string | null; runId?: string },
): Record<string, string> {
  const runId = opts?.runId?.trim() || newFloksRunId();
  const workspace = opts?.workspaceId?.trim() || spec.flockId;
  const user = opts?.ownerId?.trim() || spec.birdId;
  return {
    floks_run_id: runId,
    workspace,
    user,
    bird_id: spec.birdId,
    flock_id: spec.flockId,
    purpose: "agent-computer",
    "flok.provider": "runloop",
    "flok.bird_id": spec.birdId,
    "flok.flock_id": spec.flockId,
    "flok.isolation": "linux-vm",
  };
}

export function resolveAgentComputerBlueprint(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.FLOK_RUNLOOP_BLUEPRINT?.trim() ?? "";
  const interactiveAlias = env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT?.trim() ?? "";
  if (allowComputeOnlyBlueprint(env)) {
    return named || DEFAULT_RUNLOOP_BLUEPRINT;
  }
  const candidate = named || interactiveAlias || DEFAULT_INTERACTIVE_BLUEPRINT;
  if (!named && !interactiveAlias) {
    throw new InteractiveBlueprintRequired(
      "FLOK_RUNLOOP_BLUEPRINT must be flok-runloop-interactive (or an owner-validated interactive stack); generic DnD is not an Agent Computer",
    );
  }
  if (!isInteractiveBlueprintName(candidate, env)) {
    throw new InteractiveBlueprintRequired(
      `blueprint ${candidate || "(empty)"} is not an Agent Computer image; set FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive`,
    );
  }
  return candidate;
}
