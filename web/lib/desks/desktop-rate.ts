/** Per-owner desktop route: screen poll is 1.5s (~40/min); leave headroom for act/open. */
export const DESKTOP_OWNER_LIMIT = 60;
export const DESKTOP_OWNER_WINDOW_MS = 60_000;

export function desktopOwnerRateKey(email: string): string {
  return `desktop:${email.trim().toLowerCase()}`;
}
