/**
 * Opt-in C5 real Grok Bot path. Not part of npm test / verify / CI.
 * Does not dispatch paid Runloop. Does not deploy.
 *
 * Required to actually satisfy Gate C5 against a live Grok Bot:
 *   FLOK_LIVE_MCP_GROK_TEST=1
 *   FLOK_MCP_PUBLIC_URL = https://<public-host>/mcp  (reachable from xAI)
 *
 * Then a Grok Bot custom MCP connector points at that URL, an operator
 * issues a pair code for that Bot's bird_id/flock_id, and the Bot runs
 * computer_pair → computer_status → computer_exec → computer_fs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const enabled = process.env.FLOK_LIVE_MCP_GROK_TEST === "1";

describe("C5 real Grok Bot MCP", { skip: !enabled }, () => {
  it("refuses to invent a public URL; operator must supply FLOK_MCP_PUBLIC_URL", () => {
    const url = process.env.FLOK_MCP_PUBLIC_URL?.trim();
    assert.ok(
      url && /^https:\/\//.test(url),
      "Gate C5 live Grok Bot needs a public HTTPS POST /mcp URL in FLOK_MCP_PUBLIC_URL. Do not deploy from this PR without explicit approval.",
    );
  });
});
