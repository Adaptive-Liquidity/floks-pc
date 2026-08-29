/**
 * Observe tool results: render screenshots as MCP image content.
 * Never dump pixel bytes into the text JSON the model reads.
 * Fake 1×1 PNGs are protocol coverage, not live display proof.
 */

export const MCP_MAX_SCREENSHOT_CHARS = 1_500_000;
export const PNG_MIME = "image/png";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type McpImageContent = {
  type: "image";
  data: string;
  mimeType: typeof PNG_MIME;
};

export function isPngBase64(raw: string): boolean {
  if (raw.length < 24) return false;
  const buf = Buffer.from(raw, "base64");
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

export function screenshotImageContent(screenshotBase64: string | undefined): McpImageContent | null {
  if (typeof screenshotBase64 !== "string" || screenshotBase64.length === 0) return null;
  if (screenshotBase64.length > MCP_MAX_SCREENSHOT_CHARS) return null;
  if (!isPngBase64(screenshotBase64)) return null;
  return { type: "image", data: screenshotBase64, mimeType: PNG_MIME };
}

export function textPayloadWithoutPixels(payload: Record<string, unknown>): Record<string, unknown> {
  if (!("screenshot_base64" in payload)) return payload;
  const { screenshot_base64: shot, ...rest } = payload;
  return {
    ...rest,
    has_screenshot: typeof shot === "string" && shot.length > 0,
  };
}
