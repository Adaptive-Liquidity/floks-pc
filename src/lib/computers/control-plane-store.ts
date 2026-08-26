/**
 * Durable control-plane records for L1/L3.
 * In-memory ComputerService is local/dev only. Raw capability tokens are never stored.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CapabilityScope, Computer, ComputerCapability, ComputerPairCode } from "./types.js";
import {
  CapabilityScopeSchema,
  ComputerSchema,
  ComputerCapabilitySchema,
  ComputerPairCodeSchema,
} from "./schemas.js";

const PairIssueExtrasSchema = z.object({
  scopes: z.array(CapabilityScopeSchema).min(1),
  capabilityTtlMs: z.number().int().positive(),
});

const PairFailureSchema = z.object({
  count: z.number().int().nonnegative(),
  windowStart: z.number().int().nonnegative(),
});

export const ControlPlaneSnapshotSchema = z.object({
  version: z.literal(1),
  ownerId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  computers: z.array(ComputerSchema),
  pairCodes: z.array(ComputerPairCodeSchema),
  capabilities: z.array(ComputerCapabilitySchema),
  pairIssueExtras: z.record(z.string(), PairIssueExtrasSchema),
  pairFailuresByIdentity: z.record(z.string(), PairFailureSchema),
});

export type ControlPlaneSnapshot = z.infer<typeof ControlPlaneSnapshotSchema>;

export interface ControlPlaneStore {
  load(): Promise<ControlPlaneSnapshot | null>;
  save(snapshot: ControlPlaneSnapshot): Promise<void>;
}

export class MemoryControlPlaneStore implements ControlPlaneStore {
  private snapshot: ControlPlaneSnapshot | null = null;
  async load(): Promise<ControlPlaneSnapshot | null> {
    return this.snapshot;
  }
  async save(snapshot: ControlPlaneSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }
}

export class JsonFileControlPlaneStore implements ControlPlaneStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ControlPlaneSnapshot | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      if (!raw.trim()) {
        throw new Error(`control-plane store is empty or truncated: ${this.path}`);
      }
      return ControlPlaneSnapshotSchema.parse(JSON.parse(raw));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  async save(snapshot: ControlPlaneSnapshot): Promise<void> {
    const parsed = ControlPlaneSnapshotSchema.parse(snapshot);
    assertSnapshotHasNoRawSecrets(parsed);
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.path);
  }
}

export function controlPlaneStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  providerName: string,
): ControlPlaneStore | undefined {
  const path = env.FLOK_CONTROL_PLANE_PATH?.trim();
  if (path) return new JsonFileControlPlaneStore(path);
  if (providerName === "runloop") {
    return new JsonFileControlPlaneStore(".flok/control-plane.json");
  }
  return undefined;
}

export function assertSnapshotHasNoRawSecrets(snapshot: ControlPlaneSnapshot): void {
  const blob = JSON.stringify(snapshot);
  if (/"token"\s*:\s*"[^"]{16,}"/.test(blob) && blob.includes("capability")) {
    throw new Error("refusing to persist a raw capability token");
  }
}

export type PairIssueExtras = { scopes: CapabilityScope[]; capabilityTtlMs: number };

export function computersFromSnapshot(snapshot: ControlPlaneSnapshot): Computer[] {
  return snapshot.computers.map((c) => ({
    ...c,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
    lastActiveAt: c.lastActiveAt ? new Date(c.lastActiveAt) : null,
  }));
}

export function pairCodesFromSnapshot(snapshot: ControlPlaneSnapshot): ComputerPairCode[] {
  return snapshot.pairCodes.map((p) => ({
    ...p,
    expiresAt: new Date(p.expiresAt),
    usedAt: p.usedAt ? new Date(p.usedAt) : null,
    createdAt: new Date(p.createdAt),
  }));
}

export function capabilitiesFromSnapshot(snapshot: ControlPlaneSnapshot): ComputerCapability[] {
  return snapshot.capabilities.map((c) => ({
    ...c,
    issuedAt: new Date(c.issuedAt),
    expiresAt: new Date(c.expiresAt),
    revokedAt: c.revokedAt ? new Date(c.revokedAt) : null,
    lastUsedAt: c.lastUsedAt ? new Date(c.lastUsedAt) : null,
  }));
}
