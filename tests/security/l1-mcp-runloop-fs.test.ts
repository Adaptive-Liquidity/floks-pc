/**
 * L1: computer_fs write/read/list/stat through MCP → ComputerService → RunloopProvider.
 * Uses MemoryRunloopControlPlane (unpaid). FakeProvider is not this proof.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerService,
  MemoryRunloopControlPlane,
  RunloopProvider,
} from "../../src/lib/computers/index.js";
import { McpGateway } from "../../src/lib/mcp/index.js";

describe("L1 MCP Runloop computer_fs write/read", () => {
  async function pair() {
    const provider = new RunloopProvider({
      client: new MemoryRunloopControlPlane(),
      blueprint: "flok-runloop-interactive",
    });
    const service = new ComputerService(provider);
    const gateway = new McpGateway(service);
    const computer = await service.requestComputer({
      birdId: "bird-local",
      flockId: "flock-local",
    });
    const issued = await service.issuePairCode(computer.id);
    const pairRes = await gateway.handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "computer_pair",
          arguments: {
            pair_code: issued.code,
            bird_id: "bird-local",
            flock_id: "flock-local",
          },
        },
      },
      {},
    );
    const payload = (pairRes as { result: { structuredContent: Record<string, unknown> } }).result
      .structuredContent;
    return {
      gateway,
      token: String(payload.capability_token),
      handle: String(payload.computer_handle),
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
    const result = (res as { result: { isError: boolean; structuredContent: Record<string, unknown> } })
      .result;
    return result;
  }

  it("write then MCP read returns the exact content; stat/list agree", async () => {
    const { gateway, token, handle } = await pair();
    const path = "/home/user/flok/notes/hello.txt";
    const content = "agent-computer-fs-regression\n";

    const mkdir = await fs(gateway, token, handle, { operation: "mkdir", path: "/home/user/flok/notes" });
    assert.equal(mkdir.isError, false);

    const write = await fs(gateway, token, handle, { operation: "write", path, content });
    assert.equal(write.isError, false);
    assert.equal(write.structuredContent.ok, true);

    const read = await fs(gateway, token, handle, { operation: "read", path });
    assert.equal(read.isError, false);
    assert.equal(read.structuredContent.data, content);

    const stat = await fs(gateway, token, handle, { operation: "stat", path });
    assert.equal(stat.isError, false);
    const statData = stat.structuredContent.data as { size: number; isDir: boolean };
    assert.equal(statData.isDir, false);
    assert.equal(statData.size, Buffer.byteLength(content, "utf8"));

    const list = await fs(gateway, token, handle, {
      operation: "list",
      path: "/home/user/flok/notes",
    });
    assert.equal(list.isError, false);
    assert.deepEqual(list.structuredContent.data, ["hello.txt"]);
  });
});
