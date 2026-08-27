/**
 * Control-plane destroy for the Agent Computer(s) in the durable store.
 * Not an MCP tool. Never bulk-shutdown the Runloop account.
 *
 * Only destroys computers recorded in FLOK_CONTROL_PLANE_PATH.
 * If more than one candidate matches, exits without destroying.
 */
import { z } from "zod";
import { ComputerService } from "../src/lib/computers/service.js";
import { createMcpProvider } from "../src/mcp-server.js";
import { controlPlaneStoreFromEnv } from "../src/lib/computers/control-plane-store.js";

const EnvFlagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["1", "true", "yes"]));

const DestroyEnvSchema = z.object({
  FLOK_DESTROY_CONFIRM: EnvFlagSchema,
  FLOK_MCP_PROVIDER: z.string().trim().toLowerCase().pipe(z.literal("runloop")),
  FLOK_DESTROY_PROVIDER_REF: z.string().trim().min(1),
  FLOK_CONTROL_PLANE_PATH: z.string().trim().min(1).max(4096).optional(),
});

async function main(): Promise<void> {
  const raw: {
    FLOK_DESTROY_CONFIRM?: string;
    FLOK_MCP_PROVIDER?: string;
    FLOK_DESTROY_PROVIDER_REF?: string;
    FLOK_CONTROL_PLANE_PATH?: string;
  } = {};
  if (process.env.FLOK_DESTROY_CONFIRM !== undefined) {
    raw.FLOK_DESTROY_CONFIRM = process.env.FLOK_DESTROY_CONFIRM;
  }
  if (process.env.FLOK_MCP_PROVIDER !== undefined) {
    raw.FLOK_MCP_PROVIDER = process.env.FLOK_MCP_PROVIDER;
  }
  if (process.env.FLOK_DESTROY_PROVIDER_REF !== undefined) {
    raw.FLOK_DESTROY_PROVIDER_REF = process.env.FLOK_DESTROY_PROVIDER_REF;
  }
  if (process.env.FLOK_CONTROL_PLANE_PATH !== undefined) {
    raw.FLOK_CONTROL_PLANE_PATH = process.env.FLOK_CONTROL_PLANE_PATH;
  }
  const parsed = DestroyEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")));
    if (fields.has("FLOK_DESTROY_CONFIRM")) {
      process.stderr.write(
        "Refusing to destroy: set FLOK_DESTROY_CONFIRM=1 after selecting a single FLOKS run.\n",
      );
      process.exit(2);
    }
    if (fields.has("FLOK_MCP_PROVIDER")) {
      process.stderr.write(
        "Refusing to destroy: FLOK_MCP_PROVIDER=runloop is required so this cannot no-op through FakeProvider.\n",
      );
      process.exit(2);
    }
    process.stderr.write(
      "Refusing to destroy: set FLOK_DESTROY_PROVIDER_REF to the captured providerRef from THIS FLOKS run. If unsure, do not shut down anything.\n",
    );
    process.exit(2);
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FLOK_MCP_PROVIDER: parsed.data.FLOK_MCP_PROVIDER,
    FLOK_DESTROY_PROVIDER_REF: parsed.data.FLOK_DESTROY_PROVIDER_REF,
  };
  if (parsed.data.FLOK_CONTROL_PLANE_PATH) {
    env.FLOK_CONTROL_PLANE_PATH = parsed.data.FLOK_CONTROL_PLANE_PATH;
  }
  const provider = await createMcpProvider(env);
  const store = controlPlaneStoreFromEnv(env, provider.name);
  if (!store) {
    process.stderr.write("No durable control-plane store (in-memory is local/dev only).\n");
    process.exit(2);
  }
  const service = new ComputerService(provider, { store });
  await service.hydrate();
  const wantedRef = parsed.data.FLOK_DESTROY_PROVIDER_REF;
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
