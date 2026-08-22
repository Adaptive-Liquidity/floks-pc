/**
 * State machine helpers for Flok Node Computers.
 * Illegal transitions fail closed.
 */

import type { ComputerState } from "./types.js";
import { LEGAL_TRANSITIONS } from "./types.js";
import { IllegalStateTransition } from "./errors.js";

/** Returns true if the transition is allowed by LEGAL_TRANSITIONS. */
export function canTransition(from: ComputerState, to: ComputerState): boolean {
  const allowed = LEGAL_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Throws IllegalStateTransition if the move is not permitted.
 * Use at every mutation boundary.
 */
export function assertTransition(from: ComputerState, to: ComputerState): void {
  if (!canTransition(from, to)) {
    throw new IllegalStateTransition(from, to);
  }
}

/** Convenience: list of states reachable in one step from `from`. */
export function nextStates(from: ComputerState): readonly ComputerState[] {
  return LEGAL_TRANSITIONS[from];
}

/** True only for the terminal state. */
export function isTerminal(state: ComputerState): boolean {
  return state === "deleted";
}
