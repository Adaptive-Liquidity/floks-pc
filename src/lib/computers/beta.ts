/**
 * L3 private-beta safety caps. Not L7 billing/quotas/observability.
 * Invite/approval, per-owner active cap, idle auto-shutdown, visible cost warning.
 */

import { z } from "zod";

export const DEFAULT_BETA_MAX_ACTIVE = 1;
export const DEFAULT_BETA_IDLE_TTL_MS = 30 * 60 * 1000;
export const BETA_COST_WARNING =
  "Runloop Devboxes are billed by the provider while they exist. FLOKS does not meter or invoice (that is L7). Idle machines auto-shut after the configured TTL. Stop computers you are not using.";

export const BETA_LIMITATIONS: readonly string[] = [
  "click_element requires a fresh observe({ include_accessibility: true }) AX tree; guessed and offscreen clicks fail closed.",
  "Proxies and residential egress are not included.",
  "Production scale is not proven.",
  "No guaranteed bot-detection bypass.",
  "Background jobs run via exec/files; browser computer use is the first lane.",
  "Takeover / VNC is not included.",
  "Handoffs are not implemented.",
  "In-memory ComputerService is local/dev only; private beta requires durable records.",
];

export interface BetaPolicy {
  enabled: boolean;
  maxActive: number;
  idleTtlMs: number;
  costWarning: string;
}

export const DISABLED_BETA_POLICY: BetaPolicy = {
  enabled: false,
  maxActive: DEFAULT_BETA_MAX_ACTIVE,
  idleTtlMs: DEFAULT_BETA_IDLE_TTL_MS,
  costWarning: BETA_COST_WARNING,
};

const OwnerIdSchema = z.string().trim().min(1).max(128);

const PositivePortableInt = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((s) => Number.parseInt(s, 10));

function envFlagOn(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function betaPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): BetaPolicy {
  if (!envFlagOn(env.FLOK_BETA_ENABLED)) {
    return { ...DISABLED_BETA_POLICY };
  }
  const maxRaw = env.FLOK_BETA_MAX_ACTIVE;
  const ttlRaw = env.FLOK_BETA_IDLE_TTL_MS;
  const maxActive = maxRaw
    ? z.number().int().min(1).max(5).parse(PositivePortableInt.parse(maxRaw))
    : DEFAULT_BETA_MAX_ACTIVE;
  const idleTtlMs = ttlRaw
    ? z.number().int().min(1000).max(86_400_000).parse(PositivePortableInt.parse(ttlRaw))
    : DEFAULT_BETA_IDLE_TTL_MS;
  return {
    enabled: true,
    maxActive,
    idleTtlMs,
    costWarning: BETA_COST_WARNING,
  };
}

export function parseBetaOwnerId(raw: string): string {
  return OwnerIdSchema.parse(raw);
}

export function isActiveBetaComputer(state: string): boolean {
  return state !== "deleted" && state !== "deleting";
}



export interface BetaRoster {
  approved: string[];
  waitlist: string[];
}

export interface BetaStore {
  load(): Promise<BetaRoster>;
  save(roster: BetaRoster): Promise<void>;
}

export class MemoryBetaStore implements BetaStore {
  private roster: BetaRoster = { approved: [], waitlist: [] };
  async load(): Promise<BetaRoster> {
    return {
      approved: [...this.roster.approved],
      waitlist: [...this.roster.waitlist],
    };
  }
  async save(roster: BetaRoster): Promise<void> {
    this.roster = {
      approved: [...roster.approved],
      waitlist: [...roster.waitlist],
    };
  }
}

export class BetaRegistry {
  private approved = new Set<string>();
  private waitlist = new Set<string>();
  private mutationChain: Promise<void> = Promise.resolve();

  constructor(private readonly store?: BetaStore) {}

  async hydrate(): Promise<void> {
    if (!this.store) return;
    const roster = await this.store.load();
    this.approved = new Set(roster.approved);
    this.waitlist = new Set(roster.waitlist);
  }

  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(fn, fn);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  snapshot(): BetaRoster {
    return {
      approved: [...this.approved],
      waitlist: [...this.waitlist],
    };
  }

  isApproved(ownerId: string): boolean {
    return this.approved.has(ownerId);
  }

  async waitlistOwner(ownerId: string): Promise<BetaRoster> {
    const id = parseBetaOwnerId(ownerId);
    return this.enqueueMutation(async () => {
      if (!this.approved.has(id)) this.waitlist.add(id);
      const snap = this.snapshot();
      if (this.store) await this.store.save(snap);
      return snap;
    });
  }

  async approveOwner(ownerId: string): Promise<BetaRoster> {
    const id = parseBetaOwnerId(ownerId);
    return this.enqueueMutation(async () => {
      this.waitlist.delete(id);
      this.approved.add(id);
      const snap = this.snapshot();
      if (this.store) await this.store.save(snap);
      return snap;
    });
  }
}

export function knownLimitationsMarkdown(): string {
  const lines = [
    "# Known limitations (L3 private beta)",
    "",
    "This is fail-closed launch security, not production-ready multi-tenant security.",
    "",
    ...BETA_LIMITATIONS.map((line) => `- ${line}`),
    "",
    "## Cost",
    "",
    BETA_COST_WARNING,
    "",
    "Do not add MCP tools. Destroy is operator control-plane, not an MCP tool.",
    "",
  ];
  return lines.join("\n");
}
