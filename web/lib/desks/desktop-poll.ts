export const DESKTOP_POLL_MS = 1500;
export const DESKTOP_POLL_MAX_MS = 15_000;

/**
 * Next live-view delay. null = do not start another request
 * (previous still in flight, or the tab is hidden).
 */
export function desktopPollDelay(input: {
  inFlight: boolean;
  hidden: boolean;
  lastError: boolean;
  lastDelayMs: number;
}): number | null {
  if (input.inFlight || input.hidden) return null;
  if (!input.lastError) return DESKTOP_POLL_MS;
  const previous = input.lastDelayMs > 0 ? input.lastDelayMs : DESKTOP_POLL_MS;
  return Math.min(DESKTOP_POLL_MAX_MS, previous * 2);
}
