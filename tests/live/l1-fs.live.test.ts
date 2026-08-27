/**
 * Owner-approved paid L1 fs smoke. Not part of npm test / verify / PR CI.
 *
 * One interactive Agent Computer. MCP computer_fs write → read/stat/list.
 * Always destroy this-run Devbox in finally. No snapshots, no C9, no extra MCP tools.
 *
 *   FLOK_LIVE_RUNLOOP_L1_FS_TEST=1
 *   RUNLOOP_API_KEY=...
 *   FLOK_RUNLOOP_BLUEPRINT=flok-runloop-interactive
 *   npm run test:live:runloop-l1-fs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ComputerService, RunloopProvider } from "../../src/lib/computers/index.js";
import { McpGateway } from "../../src/lib/mcp/index.js";

const LIVE = process.env.FLOK_LIVE_RUNLOOP_L1_FS_TEST === "1";
const BIRD = "bird-l1-fs";
const FLOCK = "flock-l1-fs";
const NOTES = "/home/user/flok/notes";
const PATH = `${NOTES}/hello.txt`;
const CONTENT = "agent-computer-l1-fs-live\n";

function redact(text: string): string {
  return text
    .replace(/dbx_[A-Za-z0-9]+/g, "dbx_REDACTED")
    .replace(/ak_[A-Za-z0-9]+/g, "ak_REDACTED");
}

const ToolCallResultSchema = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    structuredContent: z.record(z.string(), z.unknown()),
  }),
});

function expectToolResult(res: unknown): {
  isError: boolean;
  structuredContent: Record<string, unknown>;
} {
  const parsed = ToolCallResultSchema.safeParse(res);
  if (!parsed.success) {
    throw new Error(`unexpected JSON-RPC response: ${redact(JSON.stringify(res))}`);
  }
  return {
    isError: parsed.data.result.isError ?? false,
    structuredContent: parsed.data.result.structuredContent,
  };
}

async function fs(
  gateway: McpGateway,
  token: string,
  handle: string,
  args: Record<string, unknown>,
) {
  const res = await gateway.handleJsonRpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "computer_fs",
        arguments: { capability_token: token, computer_handle: handle, ...args },
      },
    },
    {},
  );
  return expectToolResult(res);
}

describe("L1 live Runloop MCP computer_fs", { skip: !LIVE, timeout: 720_000 }, () => {
  before(() => {
    if (!process.env.RUNLOOP_API_KEY) {
      throw new Error("FLOK_LIVE_RUNLOOP_L1_FS_TEST=1 but RUNLOOP_API_KEY is missing (must FAIL, not skip)");
    }
    if (!process.env.FLOK_RUNLOOP_BLUEPRINT && !process.env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT) {
      throw new Error(
        "FLOK_LIVE_RUNLOOP_L1_FS_TEST=1 but FLOK_RUNLOOP_BLUEPRINT is missing (must FAIL, not skip)",
      );
    }
    if (process.env.FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY) {
      throw new Error("L1 fs live must not set FLOK_RUNLOOP_ALLOW_COMPUTE_ONLY");
    }
  });

  it("write then MCP read returns the exact content; stat/list agree; then destroy this run", async () => {
    process.env.FLOK_RUNLOOP_KEEP_ALIVE_SECONDS ??= "900";
    if (process.env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT && !process.env.FLOK_RUNLOOP_BLUEPRINT) {
      process.env.FLOK_RUNLOOP_BLUEPRINT = process.env.FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT;
    }
    const provider = await RunloopProvider.fromEnv();
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    let providerRef: string | null = null;
    try {
      const computer = await service.requestComputer({ birdId: BIRD, flockId: FLOCK });
      providerRef = computer.providerRef;
      assert.ok(providerRef, "provision: missing providerRef");
      const issued = await service.issuePairCode(computer.id);
      const pairRes = await gateway.handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "computer_pair",
            arguments: { pair_code: issued.code, bird_id: BIRD, flock_id: FLOCK },
          },
        },
        {},
      );
      const payload = expectToolResult(pairRes).structuredContent;
      const token = String(payload.capability_token);
      const handle = String(payload.computer_handle);

      const mkdir = await fs(gateway, token, handle, { operation: "mkdir", path: NOTES });
      assert.equal(mkdir.isError, false, redact(JSON.stringify(mkdir.structuredContent)));

      const write = await fs(gateway, token, handle, { operation: "write", path: PATH, content: CONTENT });
      assert.equal(write.isError, false, redact(JSON.stringify(write.structuredContent)));
      assert.equal(write.structuredContent.ok, true);

      const read = await fs(gateway, token, handle, { operation: "read", path: PATH });
      assert.equal(read.isError, false, redact(JSON.stringify(read.structuredContent)));
      assert.equal(read.structuredContent.data, CONTENT);

      const stat = await fs(gateway, token, handle, { operation: "stat", path: PATH });
      assert.equal(stat.isError, false, redact(JSON.stringify(stat.structuredContent)));
      const statData = stat.structuredContent.data as { size: number; isDir: boolean };
      assert.equal(statData.isDir, false);
      assert.equal(statData.size, Buffer.byteLength(CONTENT, "utf8"));

      const list = await fs(gateway, token, handle, { operation: "list", path: NOTES });
      assert.equal(list.isError, false, redact(JSON.stringify(list.structuredContent)));
      assert.deepEqual(list.structuredContent.data, ["hello.txt"]);
    } finally {
      if (providerRef) {
        await provider.destroy(providerRef).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "destroy failed";
          process.stderr.write(`L1 fs live cleanup: ${redact(message)}\n`);
        });
      }
    }
  });
});
