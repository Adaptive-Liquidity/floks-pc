/**
 * Opt-in MCP HTTP listener. FakeProvider by default — no paid Runloop.
 * Set FLOK_MCP_PROVIDER=runloop (and RUNLOOP_API_KEY) only when the owner
 * explicitly approves a paid Devbox. Requires FLOK_MCP_COMPUTERS_ENABLED=1.
 * Does not read ~/flok/token.
 *
 * Optional local bootstrap (control-plane, not an MCP tool):
 *   FLOK_MCP_BOOTSTRAP=1
 *   FLOK_MCP_BOOTSTRAP_BIRD_ID=bird-local
 *   FLOK_MCP_BOOTSTRAP_FLOCK_ID=flock-local
 * Provisions one FakeProvider computer and prints a one-time pair code to stdout.
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ComputerService } from "./lib/computers/service.js";
import { FakeProvider } from "./lib/computers/providers/fake.js";
import { RunloopProvider } from "./lib/computers/providers/runloop.js";
import {
  controlPlaneStoreFromEnv,
  type ControlPlaneStore,
} from "./lib/computers/control-plane-store.js";
import { ComputerError } from "./lib/computers/errors.js";
import { assertNexusDisabled } from "./lib/computers/flags.js";
import type { ComputerProvider } from "./lib/computers/providers/provider.js";
import {
  assertRemoteMcpExposure,
  loadMcpGatewayConfig,
  mcpComputersEnabled,
  McpGateway,
  MCP_PATH,
} from "./lib/mcp/index.js";
import { endUnhandledMcpError, handleMcpHttp } from "./lib/mcp/http.js";
import {
  OPERATOR_CONSOLE_PATH,
  handleOperatorHttp,
} from "./lib/operator/index.js";

function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isLoopbackListenHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1";
}

export const DEFAULT_OPERATOR_LISTEN_PORT = 8788;

const OperatorPortSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((s) => Number.parseInt(s, 10))
  .pipe(z.number().int().min(1).max(65535));

/** Full-string port parse. Rejects `1e3` / `8788junk` that Number.parseInt would accept. */
export function resolveOperatorListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FLOK_OPERATOR_LISTEN_PORT?.trim();
  if (!raw) return DEFAULT_OPERATOR_LISTEN_PORT;
  const parsed = OperatorPortSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ComputerError(
      "OPERATOR_PORT_INVALID",
      "FLOK_OPERATOR_LISTEN_PORT must be an integer between 1 and 65535",
    );
  }
  return parsed.data;
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

/** Same length cap as MCP `computer_pair` bird_id / flock_id. */
const BootstrapIdentitySchema = z.object({
  birdId: z.string().min(1).max(128),
  flockId: z.string().min(1).max(128),
});

/** Default Fake. `runloop` is paid and must be chosen explicitly. */
export async function createMcpProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ComputerProvider> {
  const name = env.FLOK_MCP_PROVIDER?.trim().toLowerCase() ?? "";
  if (name === "" || name === "fake") {
    return new FakeProvider();
  }
  if (name === "runloop") {
    return RunloopProvider.fromEnv();
  }
  throw new ComputerError(
    "MCP_PROVIDER_UNKNOWN",
    "FLOK_MCP_PROVIDER must be unset, fake, or runloop",
  );
}

export async function bootstrapLocalComputer(
  service: ComputerService,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ birdId: string; flockId: string; computerId: string; pairCode: string } | null> {
  if (!envFlag("FLOK_MCP_BOOTSTRAP", env)) return null;
  let birdId: string;
  let flockId: string;
  try {
    const identity = BootstrapIdentitySchema.parse({
      birdId: env.FLOK_MCP_BOOTSTRAP_BIRD_ID?.trim() || "bird-local",
      flockId: env.FLOK_MCP_BOOTSTRAP_FLOCK_ID?.trim() || "flock-local",
    });
    birdId = identity.birdId;
    flockId = identity.flockId;
  } catch {
    throw new ComputerError(
      "BOOTSTRAP_IDENTITY_INVALID",
      "FLOK_MCP_BOOTSTRAP_BIRD_ID and FLOK_MCP_BOOTSTRAP_FLOCK_ID must be 1–128 characters",
    );
  }
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
  assertRemoteMcpExposure(config);
  const provider = await createMcpProvider();
  const store = controlPlaneStoreFromEnv(process.env, provider.name);
  const serviceOpts: {
    store?: ControlPlaneStore;
    ownerId: string | null;
    workspaceId: string | null;
  } = {
    ownerId: process.env.FLOK_OWNER_ID?.trim() || null,
    workspaceId: process.env.FLOK_WORKSPACE_ID?.trim() || null,
  };
  if (store) serviceOpts.store = store;
  const service = new ComputerService(provider, serviceOpts);
  await service.hydrate();
  const gateway = new McpGateway(service);
  const boot = await bootstrapLocalComputer(service);

  const server = createServer((req, res) => {
    void handleMcpHttp(req, res, { gateway, config, path: MCP_PATH }).catch(() => {
      endUnhandledMcpError(res);
    });
  });
  const operatorPort = resolveOperatorListenPort(process.env);
  if (operatorPort === port) {
    throw new ComputerError(
      "OPERATOR_PORT_COLLISION",
      "Operator console must not share the MCP listen port (Bot wrapper auth is not operator auth)",
    );
  }
  const operatorServer = createServer((req, res) => {
    void handleOperatorHttp(req, res, { service, config }).catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { code: "INTERNAL", message: "internal error" } }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    operatorServer.once("error", reject);
    operatorServer.listen(operatorPort, "127.0.0.1", () => resolve());
  });

  const displayHost = host.includes(":") ? `[${host}]` : host;
  process.stdout.write(`flok-mcp-gateway listening on http://${displayHost}:${port}${MCP_PATH}\n`);
  process.stdout.write(
    `operator console: http://127.0.0.1:${operatorPort}${OPERATOR_CONSOLE_PATH} (loopback Live Node Console; not an MCP tool; not the Grok wrapper token)\n`,
  );
  if (isLoopbackListenHost(host)) {
    process.stdout.write(
      "127.0.0.1 is not a real remote Grok Bot endpoint. A remote Grok Bot needs an authenticated HTTPS endpoint that forwards to the MCP server and requires FLOK_MCP_AUTH_TOKEN.\n",
    );
  }
  if (config.baseUrl) {
    process.stdout.write(`public base URL (config): ${config.baseUrl}\n`);
    process.stdout.write(
      "remote Grok Bot path: authenticated HTTPS. FLOK_MCP_AUTH_TOKEN is mandatory. Do not log the token.\n",
    );
  }
  if (store) {
    process.stdout.write("control-plane store: durable (records survive MCP restart)\n");
  } else {
    process.stdout.write("control-plane store: in-memory (local/dev only; not private beta)\n");
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
