/**
 * L1: Agent Computer blueprints must be interactive.
 * Generic compute-only DnD is not an Agent Computer.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_RUNLOOP_BLUEPRINT } from "./runloop-client.js";
import { DEFAULT_INTERACTIVE_BLUEPRINT } from "./runloop-interactive.js";
import { ComputerError } from "../errors.js";

const EnvFlagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["1", "true", "yes"]));

const OptionalNameSchema = z.string().trim();

function envName(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key];
  if (raw === undefined) return "";
  return OptionalNameSchema.parse(raw);
}

export class InteractiveBlueprintRequired extends ComputerError {
  constructor(detail: string) {
    super("INTERACTIVE_BLUEPRINT_REQUIRED", detail);
    this.name = "InteractiveBlueprintRequired";
  }
}

export function allowComputeOnlyBlueprint(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY;
  if (raw === undefined) return false;
  return EnvFlagSchema.safeParse(raw).success;
}

export function isGenericComputeBlueprint(name: string): boolean {
  const n = name.trim();
  return n === DEFAULT_RUNLOOP_BLUEPRINT || n === "runloop/universal-ubuntu-24.04-x86_64-dnd";
}

export function isInteractiveBlueprintName(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const n = OptionalNameSchema.parse(name);
  if (!n) return false;
  if (isGenericComputeBlueprint(n)) return false;
  const extra = envName(env, "FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT");
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
  // Runloop rejects metadata with more than 8 keys.
  return {
    floks_run_id: runId,
    workspace,
    user,
    bird_id: spec.birdId,
    flock_id: spec.flockId,
    purpose: "agent-computer",
    "flok.provider": "runloop",
    "flok.isolation": "linux-vm",
  };
}

export function resolveAgentComputerBlueprint(env: NodeJS.ProcessEnv = process.env): string {
  const named = envName(env, "FLOK_RUNLOOP_BLUEPRINT");
  const interactiveAlias = envName(env, "FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT");
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
