/**
 * Control-plane destroy for the Agent Computer(s) in the durable store.
 * Not an MCP tool. Never bulk-shutdown the Runloop account.
 *
 * Only destroys computers recorded in FLOK_CONTROL_PLANE_PATH.
 * If more than one candidate matches, exits without destroying.
 */
import { ComputerService } from "../src/lib/computers/service.js";
import { createMcpProvider } from "../src/mcp-server.js";
import { controlPlaneStoreFromEnv } from "../src/lib/computers/control-plane-store.js";

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function main(): Promise<void> {
  if (!envFlag("FLOK_DESTROY_CONFIRM")) {
    process.stderr.write(
      "Refusing to destroy: set FLOK_DESTROY_CONFIRM=1 after selecting a single FLOKS run.\n",
    );
    process.exit(2);
  }
  const providerName = process.env.FLOK_MCP_PROVIDER?.trim().toLowerCase() ?? "";
  if (providerName !== "runloop") {
    process.stderr.write(
      "Refusing to destroy: FLOK_MCP_PROVIDER=runloop is required so this cannot no-op through FakeProvider.\n",
    );
    process.exit(2);
  }
  const provider = await createMcpProvider();
  const store = controlPlaneStoreFromEnv(process.env, provider.name);
  if (!store) {
    process.stderr.write("No durable control-plane store (in-memory is local/dev only).\n");
    process.exit(2);
  }
  const service = new ComputerService(provider, { store });
  await service.hydrate();
  const wantedRef = process.env.FLOK_DESTROY_PROVIDER_REF?.trim();
  if (!wantedRef) {
    process.stderr.write(
      "Refusing to destroy: set FLOK_DESTROY_PROVIDER_REF to the captured providerRef from THIS FLOKS run. If unsure, do not shut down anything.\n",
    );
    process.exit(2);
  }
  const live = service.list().filter((c) => c.state !== "deleted" && c.providerRef);
  const selected = live.filter((c) => c.providerRef === wantedRef);
  if (selected.length !== 1) {
    process.stderr.write(
      `Candidates: ${selected.length}. Only shut down the Devbox created by this FLOKS run. If more than one candidate matches or unsure, stop.\n`,
    );
    process.exit(2);
  }
  const target = selected[0];
  if (!target?.providerRef) {
    process.stderr.write("No providerRef on selected computer.\n");
    process.exit(2);
  }
  if (target.state !== "deleting") {
    await service.transition(target.id, "deleting");
  }
  await service.transition(target.id, "deleted");
  process.stdout.write(`destroyed computer=${target.id} (providerRef captured for this run only)\n`);
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  process.stderr.write(`destroy-floks-run failed: ${message}\n`);
  process.exit(1);
});
