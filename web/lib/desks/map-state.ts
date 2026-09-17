import type { DeskState } from "../types";

const PROVISIONING = new Set([
  "requested",
  "provisioning",
  "waking",
  "recovering",
  "checkpointing",
]);

const FAILED = new Set([
  "error",
  "restore_failed",
  "recovery_failed",
  "cleanup_needed",
]);

const SLEEPING = new Set(["paused", "stopped"]);

const SHUT_DOWN = new Set(["deleted", "deleting"]);

export function mapComputerState(input: {
  computerState: string | null;
  pairStatus: "unpaired" | "pairing" | "paired";
  hoursUsed: number;
  hoursIncluded: number;
  seatStatus: "active" | "past_due" | "canceled";
}): DeskState {
  if (input.seatStatus === "canceled") return "shut_down";
  if (input.hoursIncluded > 0 && input.hoursUsed >= input.hoursIncluded) return "hours_empty";
  if (!input.computerState) return "unused";
  if (FAILED.has(input.computerState)) return "failed";
  if (SHUT_DOWN.has(input.computerState)) return "shut_down";
  if (PROVISIONING.has(input.computerState)) return "provisioning";
  if (SLEEPING.has(input.computerState)) return "sleeping";
  if (input.pairStatus === "pairing") return "pairing";
  if (input.pairStatus === "unpaired") return "unused";
  if (input.computerState === "running" || input.computerState === "ready") return "running";
  return "unused";
}
