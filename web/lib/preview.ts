/** Public /setup must not advertise hatch/desk scenario galleries. */
export function previewEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.FLOK_WEB_PREVIEW === "1";
}
