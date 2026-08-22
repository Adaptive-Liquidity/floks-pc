/**
 * Opt-in MCP HTTP listener. FakeProvider only — no paid Runloop.
 * Requires FLOK_MCP_COMPUTERS_ENABLED=1. Does not read ~/flok/token.
 */

import { createServer } from "node:http";
import { ComputerService } from "./lib/computers/service.js";
import { FakeProvider } from "./lib/computers/providers/fake.js";
import { assertNexusDisabled } from "./lib/computers/flags.js";
import {
  handleMcpHttp,
  loadMcpGatewayConfig,
  mcpComputersEnabled,
  McpGateway,
  MCP_PATH,
} from "./lib/mcp/index.js";

assertNexusDisabled();

if (!mcpComputersEnabled()) {
  process.stderr.write(
    "FLOK_MCP_COMPUTERS_ENABLED is not set. Refusing to bind the MCP gateway.\n",
  );
  process.exit(1);
}

const config = loadMcpGatewayConfig();
const host = config.listenHost ?? "127.0.0.1";
const port = config.listenPort ?? 8787;
const service = new ComputerService(new FakeProvider());
const gateway = new McpGateway(service);

const server = createServer((req, res) => {
  void handleMcpHttp(req, res, { gateway, config, path: MCP_PATH });
});

server.listen(port, host, () => {
  process.stdout.write(`flok-mcp-gateway listening on http://${host}:${port}${MCP_PATH}\n`);
  if (config.baseUrl) {
    process.stdout.write(`public base URL (config): ${config.baseUrl}\n`);
  }
});
