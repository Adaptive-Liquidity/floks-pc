/**
 * Observe MCP image helper. Unpaid. Not live Runloop proof.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_MAX_SCREENSHOT_CHARS,
  isPngBase64,
  screenshotImageContent,
  textPayloadWithoutPixels,
} from "../../src/lib/mcp/observe-content.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("observe MCP image content", () => {
  it("accepts a PNG and strips pixels from the text payload", () => {
    assert.equal(isPngBase64(PNG_1X1), true);
    const image = screenshotImageContent(PNG_1X1);
    assert.equal(image?.type, "image");
    assert.equal(image?.mimeType, "image/png");
    const text = textPayloadWithoutPixels({
      screen_width: 1280,
      screenshot_base64: PNG_1X1,
    });
    assert.equal("screenshot_base64" in text, false);
    assert.equal(text.has_screenshot, true);
    assert.equal(text.screen_width, 1280);
  });

  it("fail-closes non-PNG and oversized payloads", () => {
    assert.equal(screenshotImageContent("not-a-png"), null);
    assert.equal(screenshotImageContent("a".repeat(MCP_MAX_SCREENSHOT_CHARS + 1)), null);
    assert.equal(screenshotImageContent(undefined), null);
  });
});
