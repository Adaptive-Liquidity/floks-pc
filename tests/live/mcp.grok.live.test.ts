/**
 * Opt-in remote Grok Bot path. Not part of npm test / verify / CI.
 * Does not dispatch paid Runloop. Does not deploy a tunnel.
 *
 * Required for a live remote Grok Bot check (owner-approved HTTPS endpoint):
 *   FLOK_LIVE_MCP_GROK_TEST=1
 *   FLOK_MCP_PUBLIC_URL = https://<public-host>/mcp
 *   FLOK_MCP_AUTH_TOKEN = <wrapper bearer>
 *
 * Then point the Grok Bot MCP connector at that HTTPS URL with
 * Authorization: Bearer <token> and run computer_pair → computer_status →
 * computer_observe → computer_fs. See docs/computers/REMOTE_GROK_MCP.md.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertRemoteMcpExposure } from "../../src/lib/mcp/index.js";

const enabled = process.env.FLOK_LIVE_MCP_GROK_TEST === "1";

describe("remote Grok Bot MCP live checklist", { skip: !enabled }, () => {
  it("refuses to invent a public URL; HTTPS + wrapper token are required", () => {
    const url = process.env.FLOK_MCP_PUBLIC_URL?.trim();
    const token = process.env.FLOK_MCP_AUTH_TOKEN?.trim();
    assert.ok(
      url && token,
      "Live remote Grok Bot needs FLOK_MCP_PUBLIC_URL (https://…/mcp) and FLOK_MCP_AUTH_TOKEN. Do not run paid Runloop without owner approval.",
    );
    assert.doesNotThrow(() =>
      assertRemoteMcpExposure({
        baseUrl: url,
        authToken: token,
      }),
    );
  });
});
