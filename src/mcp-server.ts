/**
 * Opt-in MCP HTTP listener. FakeProvider only — no paid Runloop.
 * Requires FLOK_MCP_COMPUTERS_ENABLED=1. Does not read ~/flok/token.
 *
 * Optional local bootstrap (control-plane, not an MCP tool):
 *   FLOK_MCP_BOOTSTRAP=1
 *   FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local
 *   FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local
 * Provisions one FakeProvider computer and prints a one-time pair code to stdout.
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { ComputerService } from "./lib/computers/service.js";
import { FakeProvider } from "./lib/computers/providers/fake.js";
import { ComputerError } from "./lib/computers/errors.js";
import { assertNexusDisabled } from "./lib/computers/flags.js";
import {
  handleMcpHttp,
  loadMcpGatewayConfig,
  mcpComputersEnabled,
  McpGateway,
  MCP_PATH,
} from "./lib/mcp/index.js";
import { endUnhandledMcpError } from "./lib/mcp/http.js";

function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isLoopbackListenHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1";
}

/** Non-loopback MCP bind requires wrapper Bearer. Connection auth, not Bot identity. */
export function assertSafeMcpBind(host: string, authToken: string | undefined): void {
  if (isLoopbackListenHost(host)) return;
  if (authToken && authToken.trim().length > 0) return;
  throw new ComputerError(
    "MCP_BIND_UNAUTHENTICATED",
    "Non-loopback MCP bind requires FLOK_MCP_AUTH_TOKEN (connection auth, not compute authority)",
    { host },
  );
}

export async function bootstrapLocalComputer(
  service: ComputerService,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ birdId: string; flockId: string; computerId: string; pairCode: string } | null> {
  if (!envFlag("FLOK_MCP_BOOTSTRAP", env)) return null;
  const birdId = env.FLOK_MCP_BOOTSTRAP_BIRD_ID?.trim() || "bird-local";
  const flockId = env.FLOK_MCP_BOOTSTRAP_FLOCK_ID?.trim() || "flock-local";
  const existing = await service.getByBird(birdId);
  if (existing && existing.flockId !== flockId) {
    throw new ComputerError(
      "BOOTSTRAP_FLOCK_MISMATCH",
      "FLOK_MCP_BOOTSTRAP_FLOCK_ID does not match the existing computer for this bird",
      { birdId },
    );
  }
  const computer = existing ?? (await service.requestComputer({ birdId, flockId }));
  const issued = await service.issuePairCode(computer.id);
  return { birdId, flockId, computerId: computer.id, pairCode: issued.code };
}

async function main(): Promise<void> {
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
  assertSafeMcpBind(host, config.authToken);
  const service = new ComputerService(new FakeProvider());
  const gateway = new McpGateway(service);
  const boot = await bootstrapLocalComputer(service);

  const server = createServer((req, res) => {
    void handleMcpHttp(req, res, { gateway, config, path: MCP_PATH }).catch(() => {
      endUnhandledMcpError(res);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const displayHost = host.includes(":") ? `[${host}]` : host;
  process.stdout.write(`flok-mcp-gateway listening on http://${displayHost}:${port}${MCP_PATH}\n`);
  if (config.baseUrl) {
    process.stdout.write(`public base URL (config): ${config.baseUrl}\n`);
  }
  if (boot) {
    process.stdout.write(
      `bootstrap computer=${boot.computerId} bird=${boot.birdId} flock=${boot.flockId}\n`,
    );
    process.stdout.write(`pair code (one-time, 10 min): ${boot.pairCode}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "unknown error";
    process.stderr.write(`flok-mcp-gateway failed: ${message}\n`);
    process.exit(1);
  });
}
