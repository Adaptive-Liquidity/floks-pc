import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import type { McpAuditRow } from "../../web/lib/mcp-audit.ts";
import { vercelMcpLogger } from "../../web/lib/mcp-log.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const SECRET = "super-secret-token-value-0123456789abcd";
const PAIR = "pair-secret-value-0123456789abcdef";

describe("production MCP audit", () => {
  it("keeps the eight tool names", () => {
    assert.deepEqual(MCP_TOOL_NAMES, [
      "computer_pair",
      "computer_status",
      "computer_exec",
      "computer_fs",
      "computer_observe",
      "computer_act",
      "handoff_send",
      "handoff_receive",
    ]);
  });

  it("writes one redacted metadata row from the production logger", () => {
    const rows: McpAuditRow[] = [];
    const logger = vercelMcpLogger({ VERCEL_ENV: "production" }, (row) => {
      rows.push(row);
    });
    logger.info("mcp.tools_call", {
      name: "computer_exec",
      instance: "abcd",
      computer_id: "computer-1",
      bird_id: "bird-1",
      capability_token: SECRET,
      pair_code: PAIR,
      output: `command output ${SECRET}`,
    });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.operation, "mcp.tools_call");
    assert.equal(row.targetClass, "computer_exec");
    assert.equal(row.computerId, "computer-1");
    assert.equal(row.birdId, "bird-1");
    assert.equal(row.traceId, "abcd");
    assert.equal(row.success, true);
    assert.equal(row.errorCode, null);
    assert.equal(row.receiptId, null);
    const blob = JSON.stringify(row);
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes(PAIR), false);
    assert.equal(blob.includes("command output"), false);
    assert.equal(blob.includes("stdout"), false);
    assert.equal(blob.includes("screenshot"), false);
  });

  it("records a failed call without storing the warning body", () => {
    const rows: McpAuditRow[] = [];
    const logger = vercelMcpLogger({ VERCEL_ENV: "production" }, (row) => {
      rows.push(row);
    });
    logger.warn("mcp.pair_denied", { code: "invalid", detail: `denied ${SECRET}` });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.success, false);
    assert.equal(rows[0]?.errorCode, "invalid");
    assert.equal(JSON.stringify(rows[0]).includes(SECRET), false);
  });

  it("does not write an audit row for Preview console logs", () => {
    const rows: McpAuditRow[] = [];
    const logger = vercelMcpLogger({ VERCEL_ENV: "preview" }, (row) => {
      rows.push(row);
    });
    logger.info("mcp.tools_call", { name: "computer_status" });
    assert.equal(rows.length, 0);
  });

  it("keeps the audit migration owner-applied and metadata-only", () => {
    const sql = readFileSync(join(ROOT, "migrations/0013_mcp_audit_events.sql"), "utf8");
    assert.match(sql, /OWNER-APPLIED/);
    assert.match(sql, /computer_audit_events/);
    const table = sql.slice(sql.indexOf("CREATE TABLE"));
    assert.match(table, /operation\s+TEXT NOT NULL/);
    assert.match(table, /success\s+BOOLEAN NOT NULL/);
    assert.doesNotMatch(table, /stdout|stderr|screenshot|token|cookie|command/i);
  });
});