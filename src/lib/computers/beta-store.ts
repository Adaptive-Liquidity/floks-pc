/**
 * Durable L3 invite/waitlist roster. Jailed under <cwd>/.flok. Digests/ids only.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { z } from "zod";
import { controlPlaneRoot } from "./control-plane-store.js";
import type { BetaRoster, BetaStore } from "./beta.js";

const RosterSchema = z.object({
  version: z.literal(1),
  approved: z.array(z.string().min(1).max(128)),
  waitlist: z.array(z.string().min(1).max(128)),
});

export const DEFAULT_BETA_STORE_RELATIVE = ".flok/beta.json";

export class JsonFileBetaStore implements BetaStore {
  constructor(private readonly path: string) {}

  async load(): Promise<BetaRoster> {
    try {
      const raw = await readFile(this.path, "utf8");
      if (!raw.trim()) return { approved: [], waitlist: [] };
      const parsed = RosterSchema.parse(JSON.parse(raw));
      return { approved: parsed.approved, waitlist: parsed.waitlist };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { approved: [], waitlist: [] };
      throw err;
    }
  }

  async save(roster: BetaRoster): Promise<void> {
    const parsed = RosterSchema.parse({ version: 1, ...roster });
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmp, this.path);
  }
}

export function jailedBetaStorePath(
  userPath: string,
  cwd: string = process.cwd(),
): string {
  const parsed = z.string().trim().min(1).max(4096).parse(userPath);
  const resolved = resolve(cwd, parsed);
  const root = controlPlaneRoot(cwd);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`FLOK_BETA_STORE_PATH must stay under ${root}`);
  }
  return resolved;
}

export function betaStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  betaEnabled: boolean,
): BetaStore | undefined {
  if (!betaEnabled) return undefined;
  const raw = env.FLOK_BETA_STORE_PATH?.trim();
  return new JsonFileBetaStore(jailedBetaStorePath(raw || DEFAULT_BETA_STORE_RELATIVE));
}
