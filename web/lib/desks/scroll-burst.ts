/** One notch, matching the previous per-tick scroll delta. */
const SCROLL_TICK = 3;

/** How long to collect wheel ticks before one scroll command. */
export const SCROLL_BURST_MS = 80;

/** Guest xdotool click --repeat cap. One command cannot scroll farther than this. */
export const SCROLL_REPEAT_CAP = 20;

export type ScrollBurstState = {
  pending: number;
  sending: boolean;
};

export function emptyScrollBurst(): ScrollBurstState {
  return { pending: 0, sending: false };
}

/** Positive deltaY scrolls down (+3). Negative scrolls up (-3). Zero is ignored. */
export function wheelScrollTick(deltaY: number): number {
  if (deltaY > 0) return SCROLL_TICK;
  if (deltaY < 0) return -SCROLL_TICK;
  return 0;
}

function capScroll(y: number): number {
  if (y > SCROLL_REPEAT_CAP) return SCROLL_REPEAT_CAP;
  if (y < -SCROLL_REPEAT_CAP) return -SCROLL_REPEAT_CAP;
  return y;
}

export function noteWheelTick(state: ScrollBurstState, deltaY: number): ScrollBurstState {
  const tick = wheelScrollTick(deltaY);
  if (tick === 0) return state;
  return { pending: capScroll(state.pending + tick), sending: state.sending };
}

/**
 * One integer y for a single scroll command.
 * Null while that command is in flight, or when the burst cancelled out.
 */
export function scrollToSend(state: ScrollBurstState): { y: number; next: ScrollBurstState } | null {
  if (state.sending || state.pending === 0) return null;
  return { y: state.pending, next: { pending: 0, sending: true } };
}

export function scrollSendFinished(state: ScrollBurstState): ScrollBurstState {
  return { pending: state.pending, sending: false };
}
