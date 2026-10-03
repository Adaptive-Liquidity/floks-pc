/**
 * ComputerService — orchestration façade.
 * Routes and MCP tools call this; it is the only thing that talks to a ComputerProvider.
 *
 * Control-plane methods (requestComputer, issuePairCode, get, transition) do not
 * take Bot capabilities — they are owner/runtime APIs. Every Bot-facing computer
 * operation (status/exec/fs/observe/act/lifecycle) requires a valid capability
 * bound to that computer + bird + flock with the right scope. Shared MCP auth
 * is never sufficient.
 *
 * C4 is in-memory; later phases replace the store with Kysely.
 *
 * Persistence (Kysely) must sweep used/expired pair codes and revoked/expired
 * capabilities from both primary maps and digest indexes, and bound pairing
 * failure windows. In-memory C4 lazily drops stale identity-failure windows
 * and expired already-used pair codes; unused expired codes stay until redeem
 * so the caller still sees PAIR_CODE_INVALID expired, and capability rows stay
 * so revoke/expiry remain observable after possession is proven.
 */

import { randomBytes } from "node:crypto";
import type { ComputerProvider } from "./providers/provider.js";
import type {
  ActionBatch,
  ActionResult,
  BotClaim,
  CapabilityScope,
  Computer,
  ComputerCapability,
  ComputerLatestCheckpoint,
  ComputerOperationAuth,
  ComputerPairCode,
  ComputerSpec,
  ComputerState,
  ComputerStatus,
  ExecRequest,
  ExecResult,
  FsRequest,
  FsResult,
  IssuedPairCode,
  IssuePairCodeOptions,
  NodeIdentity,
  Observation,
  ObserveRequest,
  PairResult,
  SharedAccountAuth,
} from "./types.js";
import {
  BetaInviteRequired,
  BetaStoreRequired,
  CapabilityExpired,
  CapabilityInvalid,
  CapabilityMissing,
  CapabilityRevoked,
  ComputerAsleep,
  ComputerNotFound,
  ComputerRebuilt,
  ComputerStarting,
  ComputerUseNotAvailable,
  InsufficientScope,
  CheckpointRequired,
  CleanupFailed,
  ComputerError,
  DestroyConfirmRequired,
  DestroyProviderRefMismatch,
  DuplicateComputer,
  ObserveRetryable,
  RestoreUnsupported,
  IllegalStateTransition,
  PairCodeInvalid,
  PathEscape,
  ProviderNeedsReplacement,
  ProviderUnavailable,
  QuotaExceeded,
  RebuildConfirmRequired,
  InvalidActivityCursor,
} from "./errors.js";
import {
  DASHBOARD_EVENT_KINDS,
  decodeActivityCursor,
  paginateActivityEvents,
  toActivityEvent,
  type ActivityStore,
} from "./activity-store.js";
import {
  BETA_COST_WARNING,
  BETA_LIMITATIONS,
  DISABLED_BETA_POLICY,
  isActiveBetaComputer,
  type BetaPolicy,
  type BetaRegistry,
} from "./beta.js";
import {
  OPERATOR_EVENT_CAP,
  OPERATOR_MCP_TOOL_COUNT,
  buildOperatorComputerView,
  computerWarnings,
  summarizeAccessibility,
  type OperatorEvent,
  type OperatorEventKind,
  type OperatorObserveResult,
  type OperatorPairStatus,
  type OperatorSnapshot,
} from "../operator/view.js";
import { assertTransition, canTransition } from "./state.js";
import {
  axCacheFromObservation,
  rewriteActSlots,
  stitchActResults,
  type AxClickCache,
} from "./click-element.js";
import {
  copyScopes,
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_PAIR_SCOPES,
  extractCapabilityToken,
  hashToken,
  hasScope,
  isCapabilityValid,
  issueCapability,
  parseScopes,
  toCapabilityRecord,
} from "./capabilities.js";
import {
  generatePairCode,
  hashPairCode,
  PAIR_CODE_TTL_MS,
  validatePairCode,
} from "./pairing.js";
import { ExecRequestSchema, FsRequestSchema } from "./schemas.js";
import {
  canonicalizeWorkspacePath,
  workspaceRootForProvider,
} from "./path.js";
import { StaleControlPlane, type ControlPlaneStore, type ControlPlaneSnapshot } from "./control-plane-store.js";
import {
  botClaimsFromSnapshot,
  capabilitiesFromSnapshot,
  computersFromSnapshot,
  pairCodesFromSnapshot,
} from "./control-plane-store.js";

function newId(): string {
  return randomBytes(16).toString("hex");
}

const PAIR_FAILURE_WINDOW_MS = PAIR_CODE_TTL_MS;
/** Per presented Node identity, not per shared MCP account. */
export const PAIR_IDENTITY_FAILURE_LIMIT = 10;

interface PairIssueExtras {
  scopes: CapabilityScope[];
  capabilityTtlMs: number;
}

interface PairFailureWindow {
  count: number;
  windowStart: number;
}

function identityKey(identity: NodeIdentity): string {
  return `${identity.birdId}\n${identity.flockId}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeChanged<T extends object>(remote: T, base: T, local: T): T {
  const merged = { ...remote };
  for (const key of Object.keys(local) as Array<keyof T>) {
    if (!sameJson(local[key], base[key])) merged[key] = local[key];
  }
  return merged;
}

export class ComputerService {
  private computers = new Map<string, Computer>();
  private byBird = new Map<string, string>(); // birdId → computerId
  private pairCodes = new Map<string, ComputerPairCode>();
  private pairCodesByDigest = new Map<string, string>();
  private pairIssueExtras = new Map<string, PairIssueExtras>();
  private capabilities = new Map<string, ComputerCapability>();
  private capabilitiesByDigest = new Map<string, string>();
  private botClaims = new Map<string, BotClaim>();
  private botClaimsByDigest = new Map<string, string>();
  private keyRenewed = false;
  /** Keyed by presented bird+flock, never by shared MCP account id. */
  private pairFailuresByIdentity = new Map<string, PairFailureWindow>();
  private readonly store: ControlPlaneStore | undefined;
  private readonly ownerId: string | null;
  private readonly workspaceId: string | null;
  private persistChain: Promise<void> = Promise.resolve();
  private revision = 0;
  private committed: ControlPlaneSnapshot | null = null;
  private operatorEvents: OperatorEvent[] = [];
  private destroyChains = new Map<string, Promise<unknown>>();
  private axByComputer = new Map<string, AxClickCache>();
  private readonly beta: BetaPolicy;
  private readonly betaRegistry: BetaRegistry | undefined;
  private readonly now: () => number;
  private readonly wakeTimeoutMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly activityStore: ActivityStore | undefined;
  private activityPersist: Promise<void> = Promise.resolve();
  private wakeAdmission: (computerId: string) => Promise<boolean> = async () => true;

  constructor(
    private readonly provider: ComputerProvider,
    opts?: {
      store?: ControlPlaneStore;
      activityStore?: ActivityStore;
      ownerId?: string | null;
      workspaceId?: string | null;
      beta?: BetaPolicy;
      betaRegistry?: BetaRegistry;
      now?: () => number;
      wakeTimeoutMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.store = opts?.store;
    this.activityStore = opts?.activityStore;
    this.ownerId = opts?.ownerId ?? null;
    this.workspaceId = opts?.workspaceId ?? null;
    this.beta = opts?.beta ?? DISABLED_BETA_POLICY;
    this.betaRegistry = opts?.betaRegistry;
    this.now = opts?.now ?? Date.now;
    this.wakeTimeoutMs = opts?.wakeTimeoutMs ?? 90_000;
    this.sleepFn =
      opts?.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** When false, a shut-down devbox stays down. Missing seats are allowed. */
  setWakeAdmission(admit: (computerId: string) => Promise<boolean>): void {
    this.wakeAdmission = admit;
  }

  async hydrate(): Promise<void> {
    if (!this.store) return;
    if (this.store.currentRevision) this.revision = await this.store.currentRevision();
    const snap = await this.store.load();
    if (!snap) {
      this.committed = this.toSnapshot();
      return;
    }
    this.applySnapshot(snap);
    this.committed = this.toSnapshot();
  }

  /** Reload when another instance has saved the shared control plane. */
  async reloadIfRevisionChanged(): Promise<void> {
    if (!this.store?.currentRevision) return;
    const latest = await this.store.currentRevision();
    if (latest !== this.revision) await this.hydrate();
  }

  private toSnapshot(): ControlPlaneSnapshot {
    const pairIssueExtras: ControlPlaneSnapshot["pairIssueExtras"] = {};
    for (const [id, extras] of this.pairIssueExtras) {
      pairIssueExtras[id] = extras;
    }
    const pairFailuresByIdentity: ControlPlaneSnapshot["pairFailuresByIdentity"] = {};
    for (const [id, win] of this.pairFailuresByIdentity) {
      pairFailuresByIdentity[id] = win;
    }
    return {
      version: 1,
      ownerId: this.ownerId,
      workspaceId: this.workspaceId,
      computers: [...this.computers.values()],
      pairCodes: [...this.pairCodes.values()],
      capabilities: [...this.capabilities.values()],
      pairIssueExtras,
      pairFailuresByIdentity,
      botClaims: [...this.botClaims.values()],
    };
  }

  private applySnapshot(snap: ControlPlaneSnapshot): void {
    this.reset();
    for (const c of computersFromSnapshot(snap)) {
      this.computers.set(c.id, c);
      if (c.state !== "deleted") this.byBird.set(c.birdId, c.id);
    }
    for (const p of pairCodesFromSnapshot(snap)) {
      this.pairCodes.set(p.id, p);
      this.pairCodesByDigest.set(p.codeDigest, p.id);
    }
    for (const cap of capabilitiesFromSnapshot(snap)) {
      this.capabilities.set(cap.id, cap);
      this.capabilitiesByDigest.set(cap.tokenDigest, cap.id);
    }
    for (const [id, extras] of Object.entries(snap.pairIssueExtras)) {
      this.pairIssueExtras.set(id, {
        scopes: extras.scopes,
        capabilityTtlMs: extras.capabilityTtlMs,
      });
    }
    for (const [id, win] of Object.entries(snap.pairFailuresByIdentity)) {
      this.pairFailuresByIdentity.set(id, win);
    }
    for (const claim of botClaimsFromSnapshot(snap)) {
      this.botClaims.set(claim.id, claim);
      this.botClaimsByDigest.set(claim.secretDigest, claim.id);
    }
  }

  private overlay(mine: ControlPlaneSnapshot, base: ControlPlaneSnapshot | null): void {
    this.overlayRecords(
      computersFromSnapshot(mine),
      new Map((base ? computersFromSnapshot(base) : []).map((row) => [row.id, row])),
      (row) => this.computers.get(row.id),
      (row) => {
        this.computers.set(row.id, row);
        if (row.state !== "deleted") this.byBird.set(row.birdId, row.id);
      },
    );
    this.overlayRecords(
      pairCodesFromSnapshot(mine),
      new Map((base?.pairCodes ?? []).map((row) => [row.id, row])),
      (row) => this.pairCodes.get(row.id),
      (row) => {
        this.pairCodes.set(row.id, row);
        this.pairCodesByDigest.set(row.codeDigest, row.id);
      },
    );
    this.overlayRecords(
      capabilitiesFromSnapshot(mine),
      new Map((base ? capabilitiesFromSnapshot(base) : []).map((row) => [row.id, row])),
      (row) => this.capabilities.get(row.id),
      (row) => {
        this.capabilities.set(row.id, row);
        this.capabilitiesByDigest.set(row.tokenDigest, row.id);
      },
    );
    const baseExtras = base?.pairIssueExtras ?? {};
    for (const [id, extras] of Object.entries(mine.pairIssueExtras)) {
      if (!sameJson(extras, baseExtras[id])) {
        this.pairIssueExtras.set(id, { scopes: extras.scopes, capabilityTtlMs: extras.capabilityTtlMs });
      }
    }
    const baseFailures = base?.pairFailuresByIdentity ?? {};
    for (const [id, win] of Object.entries(mine.pairFailuresByIdentity)) {
      if (!sameJson(win, baseFailures[id])) this.pairFailuresByIdentity.set(id, win);
    }
    const baseClaims = new Map((base?.botClaims ?? []).map((row) => [row.id, row]));
    this.overlayRecords(
      mine.botClaims ?? [],
      baseClaims,
      (row) => this.botClaims.get(row.id),
      (row) => {
        this.botClaims.set(row.id, row);
        this.botClaimsByDigest.set(row.secretDigest, row.id);
      },
    );
  }

  private overlayRecords<T extends { id: string }>(
    localRows: T[],
    baseRows: Map<string, T>,
    remoteOf: (row: T) => T | undefined,
    write: (row: T) => void,
  ): void {
    for (const local of localRows) {
      const remote = remoteOf(local);
      const prior = baseRows.get(local.id);
      if (!remote) {
        write(local);
        continue;
      }
      if (prior && !sameJson(prior, local)) write(mergeChanged(remote, prior, local));
    }
  }

  private pruneBotClaims(): void {
    const now = this.now();
    for (const [id, claim] of this.botClaims) {
      // Redeemed and denied claims stay as tombstones until expiry so a second
      // instance re-reading the snapshot sees "redeemed", not a missing row.
      if (claim.expiresAt.getTime() <= now) {
        this.botClaims.delete(id);
        this.botClaimsByDigest.delete(claim.secretDigest);
      }
    }
  }

  private async persist(): Promise<void> {
    this.pruneBotClaims();
    const store = this.store;
    if (!store) return;
    const write = async (): Promise<void> => {
      if (!store.compareAndSave) {
        await store.save(this.toSnapshot());
        return;
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const mine = this.toSnapshot();
        try {
          this.revision = await store.compareAndSave(mine, this.revision);
          this.committed = structuredClone(mine);
          return;
        } catch (err) {
          if (!(err instanceof StaleControlPlane) || attempt === 7) throw err;
          const base = this.committed;
          await this.hydrate();
          this.overlay(mine, base);
        }
      }
    };
    this.persistChain = this.persistChain.catch(() => undefined).then(write);
    await this.persistChain;
  }

  /** One compare-and-save with no overlay. A conflict throws StaleControlPlane so the caller reloads and re-checks. */
  private async persistExact(): Promise<void> {
    this.pruneBotClaims();
    const store = this.store;
    if (!store) return;
    const write = async (): Promise<void> => {
      const mine = this.toSnapshot();
      if (!store.compareAndSave) {
        await store.save(mine);
        return;
      }
      this.revision = await store.compareAndSave(mine, this.revision);
      this.committed = structuredClone(mine);
    };
    this.persistChain = this.persistChain.catch(() => undefined).then(write);
    await this.persistChain;
  }

  /** Clear all in-memory state (test helper). */
  reset(): void {
    this.computers.clear();
    this.byBird.clear();
    this.pairCodes.clear();
    this.pairCodesByDigest.clear();
    this.pairIssueExtras.clear();
    this.capabilities.clear();
    this.capabilitiesByDigest.clear();
    this.botClaims.clear();
    this.botClaimsByDigest.clear();
    this.pairFailuresByIdentity.clear();
    this.operatorEvents = [];
    this.destroyChains.clear();
    this.axByComputer.clear();
  }

  /**
   * Request a computer for a Node.
   * Enforces one-computer-per-birdId.
   * Calls provider.provision and records the resulting computer in state "ready".
   * Control-plane: does not issue a Bot capability. Pairing does that.
   */
  async requestComputer(spec: ComputerSpec): Promise<Computer> {
    await this.hydrate();
    await this.sweepIdle();
    this.assertBetaMayProvision();
    if (this.byBird.has(spec.birdId)) {
      throw new DuplicateComputer(spec.birdId);
    }

    const now = new Date(this.now());
    const id = newId();

    // Domain starts in "requested"; we immediately move through provisioning.
    let computer: Computer = {
      id,
      birdId: spec.birdId,
      flockId: spec.flockId,
      provider: this.provider.name,
      providerRef: null,
      state: "requested",
      osType: spec.osType ?? "linux",
      computerClass: spec.computerClass ?? null,
      cpu: spec.cpu ?? null,
      memoryMb: spec.memoryMb ?? null,
      diskGb: spec.diskGb ?? null,
      baseImageVersion: spec.baseImageVersion ?? null,
      workspaceRevision: 0,
      lastActiveAt: null,
      createdAt: now,
      updatedAt: now,
      latestCheckpoint: null,
      recoveryNote: null,
      rebuildConfirmRequired: false,
    };

    this.computers.set(id, computer);
    this.byBird.set(spec.birdId, id);

    // requested → provisioning
    computer = this.applyTransition(computer, "provisioning");
    await this.persist();

    // Call provider
    const provisioned = await this.provider.provision(spec);

    // provisioning → ready
    computer = {
      ...computer,
      providerRef: provisioned.providerRef,
      state: "ready",
      updatedAt: new Date(this.now()),
      lastActiveAt: new Date(this.now()),
    };
    this.computers.set(id, computer);
    await this.persist();

    return computer;
  }

  async get(computerId: string): Promise<Computer> {
    const c = this.computers.get(computerId);
    if (!c) throw new ComputerNotFound(computerId);
    return c;
  }

  async getByBird(birdId: string): Promise<Computer | null> {
    const id = this.byBird.get(birdId);
    if (!id) return null;
    return this.computers.get(id) ?? null;
  }

  /**
   * Explicit state transition. Validates against LEGAL_TRANSITIONS and updates the store.
   * Control-plane. Bot lifecycle ops go through wake/pause/stop (capability-gated).
   */
  async transition(computerId: string, to: ComputerState): Promise<Computer> {
    const current = await this.get(computerId);
    assertTransition(current.state, to);

    // Side-effects on the provider for a subset of transitions
    if (current.providerRef) {
      if (to === "running" || to === "ready") {
        // wake if coming from paused/stopped
        if (current.state === "paused" || current.state === "stopped") {
          await this.provider.wake(current.providerRef);
        }
      } else if (to === "paused") {
        await this.provider.pause(current.providerRef);
      } else if (to === "stopped") {
        await this.provider.stop(current.providerRef);
      } else if (to === "deleted") {
        await this.provider.destroy(current.providerRef);
      }
    }

    const updated = this.applyTransition(current, to);
    await this.persist();
    return updated;
  }

  private applyTransition(computer: Computer, to: ComputerState): Computer {
    assertTransition(computer.state, to);
    const updated: Computer = {
      ...computer,
      state: to,
      updatedAt: new Date(this.now()),
      lastActiveAt:
        to === "running" || to === "ready" ? new Date(this.now()) : computer.lastActiveAt,
    };
    this.computers.set(computer.id, updated);
    if (to === "deleted") {
      this.byBird.delete(computer.birdId);
      this.revokeAllForComputer(computer.id);
    }
    return updated;
  }

  private async patchComputer(
    computerId: string,
    patch: Partial<
      Pick<Computer, "latestCheckpoint" | "recoveryNote" | "providerRef" | "rebuildConfirmRequired">
    >,
  ): Promise<Computer> {
    const current = await this.get(computerId);
    const updated: Computer = {
      ...current,
      ...patch,
      updatedAt: new Date(this.now()),
    };
    this.computers.set(computerId, updated);
    await this.persist();
    return updated;
  }

  private assertObserveAvailable(computer: Computer): void {
    if (computer.state === "deleted") throw new ComputerNotFound(computer.id);
    if (computer.state === "ready" || computer.state === "running") return;
    throw new ObserveRetryable(computer.state);
  }

  /** List all computers currently tracked (test / debug helper). */
  list(): Computer[] {
    return [...this.computers.values()];
  }

  listOperatorEvents(): OperatorEvent[] {
    return this.operatorEvents.map((e) => ({ ...e }));
  }

  async listActivityEvents(
    computerId: string,
    opts?: { cursor?: string | null; limit?: number },
  ): Promise<{ events: OperatorEvent[]; nextCursor: string | null }> {
    await this.activityPersist;
    const limit = opts?.limit ?? 20;
    const cursor = opts?.cursor ?? null;
    if (cursor && !decodeActivityCursor(cursor)) {
      throw new InvalidActivityCursor();
    }
    if (this.activityStore) {
      return this.activityStore.list(computerId, {
        cursor,
        limit,
        kinds: DASHBOARD_EVENT_KINDS,
        nowMs: this.now(),
      });
    }
    return paginateActivityEvents(
      this.operatorEvents.filter((event) => event.computerId === computerId),
      { cursor, limit, kinds: DASHBOARD_EVENT_KINDS, nowMs: this.now() },
    );
  }

  /** Metadata-only handoff attempt. Never stores paths, bytes, or tokens. */
  noteHandoffAttempt(input: {
    token: string;
    operation: "handoff_send" | "handoff_receive";
  }): void {
    try {
      const cap = this.capabilityForToken(input.token);
      this.recordOperatorEvent({
        computerId: cap?.computerId ?? null,
        birdId: cap?.birdId ?? null,
        kind: "handoff",
        operation: input.operation,
        success: false,
        errorCode: "PHASE_NOT_STARTED",
      });
    } catch {
      /* logging must not change the tool result */
    }
  }

  operatorSnapshot(): OperatorSnapshot {
    const durableStore = Boolean(this.store);
    const computers = this.list().map((c) => {
      const caps = this.scopesFor(c.id);
      return buildOperatorComputerView(c, {
        pairStatus: this.pairStatusFor(c.id),
        scopes: caps.scopes,
        capabilityExpiresAt: caps.expiresAt,
        lastAction: this.lastActionFor(c.id),
        durableStore,
      });
    });
    return {
      computers,
      events: this.listOperatorEvents(),
      mcpToolCount: OPERATOR_MCP_TOOL_COUNT,
      durableStore,
      provider: this.provider.name,
      warnings: computerWarnings({
        provider: this.provider.name,
        durableStore,
      }),
      beta: {
        enabled: this.beta.enabled,
        maxActive: this.beta.maxActive,
        active: this.activeComputerCount(),
        idleTtlMs: this.beta.idleTtlMs,
        costWarning: this.beta.enabled ? this.beta.costWarning : BETA_COST_WARNING,
        approved: this.betaRegistry?.snapshot().approved ?? [],
        waitlist: this.betaRegistry?.snapshot().waitlist ?? [],
        durableStore,
      },
    };
  }

  async sweepIdle(now: number = this.now()): Promise<string[]> {
    if (!this.beta.enabled) return [];
    const destroyed: string[] = [];
    for (const computer of this.list()) {
      if (!isActiveBetaComputer(computer.state)) continue;
      const last = (computer.lastActiveAt ?? computer.createdAt).getTime();
      if (now - last < this.beta.idleTtlMs) continue;
      if (!computer.providerRef) continue;
      try {
        await this.destroyThisComputer(computer.id, {
          confirm: true,
          providerRef: computer.providerRef,
        });
        destroyed.push(computer.id);
      } catch {
        const cur = await this.get(computer.id);
        if (cur.state !== "cleanup_needed" && canTransition(cur.state, "cleanup_needed")) {
          this.applyTransition(cur, "cleanup_needed");
          await this.patchComputer(cur.id, {
            recoveryNote: "idle cleanup failed; retry with captured providerRef only",
          });
        }
        this.recordOperatorEvent({
          computerId: computer.id,
          birdId: computer.birdId,
          kind: "cleanup",
          operation: "idle-destroy",
          success: false,
          errorCode: "CLEANUP_FAILED",
        });
      }
    }
    return destroyed;
  }

  async waitlistBetaOwner(ownerId: string) {
    if (!this.betaRegistry) throw new BetaStoreRequired();
    return this.betaRegistry.waitlistOwner(ownerId);
  }

  async approveBetaOwner(ownerId: string) {
    if (!this.betaRegistry) throw new BetaStoreRequired();
    return this.betaRegistry.approveOwner(ownerId);
  }

  debugPacket(): Record<string, unknown> {
    return {
      generatedAt: new Date(this.now()).toISOString(),
      provider: this.provider.name,
      durableStore: Boolean(this.store),
      beta: {
        enabled: this.beta.enabled,
        maxActive: this.beta.maxActive,
        active: this.activeComputerCount(),
        idleTtlMs: this.beta.idleTtlMs,
        costWarning: this.beta.costWarning,
        approvedCount: this.betaRegistry?.snapshot().approved.length ?? 0,
        waitlistCount: this.betaRegistry?.snapshot().waitlist.length ?? 0,
      },
      computers: this.list().map((c) => ({
        id: c.id,
        birdId: c.birdId,
        flockId: c.flockId,
        state: c.state,
        provider: c.provider,
        lastActiveAt: c.lastActiveAt ? c.lastActiveAt.toISOString() : null,
        createdAt: c.createdAt.toISOString(),
        checkpointStatus: c.latestCheckpoint?.status ?? null,
        checkpointId: c.latestCheckpoint?.id ?? null,
        checkpointAt: c.latestCheckpoint?.createdAt.toISOString() ?? null,
        recoveryNote: c.recoveryNote,
      })),
      events: this.listOperatorEvents(),
      limitations: [...BETA_LIMITATIONS],
    };
  }

  private activeComputerCount(): number {
    return this.list().filter((c) => isActiveBetaComputer(c.state)).length;
  }

  private assertBetaMayProvision(): void {
    if (!this.beta.enabled) return;
    if (!this.store) throw new BetaStoreRequired();
    if (!this.ownerId) throw new BetaInviteRequired();
    if (!this.betaRegistry?.isApproved(this.ownerId)) {
      throw new BetaInviteRequired(this.ownerId);
    }
    if (this.activeComputerCount() >= this.beta.maxActive) {
      throw new QuotaExceeded("active-computers");
    }
  }

  async operatorObserve(
    computerId: string,
    request: ObserveRequest,
  ): Promise<OperatorObserveResult> {
    const computer = await this.get(computerId);
    this.assertObserveAvailable(computer);
    const ref = this.requireProviderRef(computer);
    await this.touch(computer);
    const observation = await this.provider.observe(ref, {
      includeAccessibility: request.includeAccessibility ?? true,
      includeScreenshot: request.includeScreenshot ?? true,
    });
    const result = this.toOperatorObserve(observation);
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "observe",
      operation: "observe",
      success: true,
      errorCode: null,
    });
    return result;
  }

  /**
   * Owner/control-plane destroy of the selected computer only.
   * Requires confirm + the captured providerRef. Not an MCP tool.
   */
  async destroyThisComputer(
    computerId: string,
    input: { confirm: boolean; providerRef: string },
  ): Promise<Computer> {
    if (input.confirm !== true) throw new DestroyConfirmRequired();
    return this.enqueueDestroy(computerId, () =>
      this.destroyThisComputerLocked(computerId, input.providerRef),
    );
  }

  private enqueueDestroy<T>(computerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.destroyChains.get(computerId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.destroyChains.set(
      computerId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async destroyThisComputerLocked(
    computerId: string,
    providerRef: string,
  ): Promise<Computer> {
    const computer = await this.get(computerId);
    if (computer.state === "deleted") return computer;
    this.axByComputer.delete(computerId);
    if (!computer.providerRef) throw new DestroyProviderRefMismatch();
    if (providerRef !== computer.providerRef) {
      throw new DestroyProviderRefMismatch();
    }
    if (computer.state !== "deleting") {
      if (computer.state === "cleanup_needed") {
        this.applyTransition(computer, "deleting");
        await this.persist();
      } else {
        await this.transition(computerId, "deleting");
      }
    }
    const current = await this.get(computerId);
    if (current.state === "deleted") return current;
    try {
      const deleted = await this.transition(computerId, "deleted");
      this.recordOperatorEvent({
        computerId: deleted.id,
        birdId: deleted.birdId,
        kind: "cleanup",
        operation: "destroy",
        success: true,
        errorCode: null,
      });
      return deleted;
    } catch {
      const failed = await this.get(computerId);
      if (failed.state === "deleting" && canTransition(failed.state, "cleanup_needed")) {
        this.applyTransition(failed, "cleanup_needed");
        await this.patchComputer(failed.id, {
          recoveryNote: "destroy failed; retry with captured providerRef only",
        });
      }
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "cleanup",
        operation: "destroy",
        success: false,
        errorCode: "CLEANUP_FAILED",
      });
      throw new CleanupFailed();
    }
  }

  /**
   * Owner/control-plane: mint a short-lived one-time pair code for a computer.
   * Previous unused codes for that computer are burned. Raw code is returned
   * once; only the digest is stored.
   */
  async issuePairCode(
    computerId: string,
    opts?: IssuePairCodeOptions,
  ): Promise<IssuedPairCode> {
    const computer = await this.get(computerId);
    if (computer.state === "deleted") {
      throw new ComputerNotFound(computerId);
    }

    // Validate caller input before any state mutation.
    const scopes = copyScopes(parseScopes(opts?.scopes ?? DEFAULT_PAIR_SCOPES));
    const capabilityTtlMs = opts?.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
    const ttlMs = opts?.ttlMs ?? PAIR_CODE_TTL_MS;

    this.sweepPairState();
    const now = new Date();
    for (const [id, rec] of this.pairCodes) {
      if (rec.computerId === computerId && rec.usedAt === null) {
        this.pairCodes.set(id, { ...rec, usedAt: now });
      }
    }

    const material = generatePairCode(ttlMs);
    const record: ComputerPairCode = {
      id: newId(),
      computerId: computer.id,
      birdId: computer.birdId,
      flockId: computer.flockId,
      codeDigest: material.digest,
      expiresAt: material.expiresAt,
      usedAt: null,
      attemptCount: 0,
      createdAt: now,
    };
    this.pairCodes.set(record.id, record);
    this.pairCodesByDigest.set(record.codeDigest, record.id);
    this.pairIssueExtras.set(record.id, { scopes, capabilityTtlMs });
    await this.persist();

    return { id: record.id, code: material.code, expiresAt: material.expiresAt };
  }

  /** Digest-only pair rows for a computer. Never includes the raw code. */
  listPairCodes(computerId: string): ComputerPairCode[] {
    return [...this.pairCodes.values()]
      .filter((rec) => rec.computerId === computerId)
      .map((rec) => ({ ...rec }));
  }

  /**
   * Owner/control-plane: burn unused pair codes for a computer.
   * Lost key → revoke and mint another. Does not revoke already-redeemed capabilities.
   */
  async revokeUnusedPairCodes(computerId: string): Promise<number> {
    await this.get(computerId);
    this.sweepPairState();
    const now = new Date();
    let burned = 0;
    for (const [id, rec] of this.pairCodes) {
      if (rec.computerId === computerId && rec.usedAt === null) {
        this.pairCodes.set(id, { ...rec, usedAt: now });
        burned += 1;
      }
    }
    if (burned > 0) await this.persist();
    return burned;
  }

  /**
   * Redeem a pair code. Shared MCP auth may be attached (C5 will have it) but
   * does not authorize issuance and is not a C4 rate-limit key — the one-time
   * pair code does, and failures are counted against the presented Node identity.
   * Returns a capability secret once. Only the digest is stored.
   */
  async pair(
    presentedCode: string,
    identity: NodeIdentity,
    sharedAuth?: SharedAccountAuth,
  ): Promise<PairResult> {
    // C5 may pass verified MCP auth later. C4 must not treat caller-supplied
    // accountId as a limiter (bypass + shared-account DoS).
    void sharedAuth;
    await this.reloadIfRevisionChanged();

    this.sweepPairState();
    this.assertPairRateLimit(identity);

    const digest = hashPairCode(presentedCode);
    const id = this.pairCodesByDigest.get(digest);
    if (!id) {
      this.notePairFailure(identity);
      throw new PairCodeInvalid("mismatch");
    }
    const record = this.pairCodes.get(id);
    if (!record) {
      this.notePairFailure(identity);
      throw new PairCodeInvalid("mismatch");
    }

    try {
      validatePairCode(presentedCode, {
        digest: record.codeDigest,
        expiresAt: record.expiresAt,
        usedAt: record.usedAt,
        attemptCount: record.attemptCount,
      });
    } catch (err) {
      this.pairCodes.set(id, { ...record, attemptCount: record.attemptCount + 1 });
      this.notePairFailure(identity);
      throw err;
    }

    const computer = this.computers.get(record.computerId);
    if (!computer || computer.state === "deleted") {
      this.pairCodes.set(id, { ...record, attemptCount: record.attemptCount + 1 });
      this.notePairFailure(identity);
      throw new PairCodeInvalid("computer gone");
    }
    if (
      computer.birdId !== identity.birdId ||
      computer.flockId !== identity.flockId ||
      record.birdId !== identity.birdId ||
      record.flockId !== identity.flockId
    ) {
      this.pairCodes.set(id, { ...record, attemptCount: record.attemptCount + 1 });
      this.notePairFailure(identity);
      throw new PairCodeInvalid("identity mismatch");
    }

    const consumed: ComputerPairCode = { ...record, usedAt: new Date() };
    this.pairCodes.set(id, consumed);

    const extras = this.pairIssueExtras.get(id);
    const scopes = copyScopes(extras?.scopes ?? parseScopes(DEFAULT_PAIR_SCOPES));
    const ttl = extras?.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
    const minted = issueCapability(ttl);
    const cap: ComputerCapability = {
      id: newId(),
      computerId: computer.id,
      birdId: computer.birdId,
      flockId: computer.flockId,
      tokenDigest: minted.digest,
      scopes,
      issuedAt: minted.issuedAt,
      expiresAt: minted.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.capabilities.set(cap.id, cap);
    this.capabilitiesByDigest.set(cap.tokenDigest, cap.id);
    await this.persist();

    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "pair",
      operation: "pair",
      success: true,
      errorCode: null,
    });

    return {
      token: minted.token,
      capabilityId: cap.id,
      computerHandle: computer.id,
      nodeHandle: computer.birdId,
      flockId: computer.flockId,
      scopes: copyScopes(scopes),
      expiresAt: cap.expiresAt,
    };
  }

  private static readonly BOT_CLAIM_TTL_MS = 15 * 60 * 1000;
  private static readonly BOT_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly BOT_KEY_RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

  private maybeRenew(capability: ComputerCapability): ComputerCapability {
    if (!capability.botLabel) return capability;
    const remaining = capability.expiresAt.getTime() - this.now();
    if (remaining >= ComputerService.BOT_KEY_RENEW_WITHIN_MS) return capability;
    const next: ComputerCapability = {
      ...capability,
      scopes: copyScopes(capability.scopes),
      expiresAt: new Date(this.now() + DEFAULT_CAPABILITY_TTL_MS),
    };
    this.capabilities.set(next.id, next);
    this.keyRenewed = true;
    return next;
  }

  private openClaimCount(flockId: string): number {
    let n = 0;
    for (const claim of this.botClaims.values()) {
      if (claim.flockId !== flockId) continue;
      if (claim.status !== "pending" && claim.status !== "approved") continue;
      if (claim.expiresAt.getTime() <= this.now()) continue;
      n += 1;
    }
    return n;
  }

  async createBotClaim(input: {
    flockId: string;
    subject: string;
  }): Promise<{ claimId: string; code: string; expiresAt: Date }> {
    await this.reloadIfRevisionChanged();
    if (this.openClaimCount(input.flockId) >= 10) throw new QuotaExceeded("bot-claims");
    const material = generatePairCode(ComputerService.BOT_CLAIM_TTL_MS);
    const now = new Date(this.now());
    const claim: BotClaim = {
      id: randomBytes(16).toString("base64url"),
      secretDigest: material.digest,
      flockId: input.flockId,
      subject: input.subject,
      botLabel: null,
      computerId: null,
      checkoutNonce: null,
      status: "pending",
      createdAt: now,
      expiresAt: new Date(this.now() + ComputerService.BOT_CLAIM_TTL_MS),
      attemptCount: 0,
    };
    this.botClaims.set(claim.id, claim);
    this.botClaimsByDigest.set(claim.secretDigest, claim.id);
    await this.persist();
    return { claimId: claim.id, code: material.code, expiresAt: claim.expiresAt };
  }

  async getBotClaim(claimId: string): Promise<BotClaim | null> {
    await this.reloadIfRevisionChanged();
    const claim = this.botClaims.get(claimId);
    if (!claim) return null;
    if (claim.status !== "redeemed" && claim.expiresAt.getTime() <= this.now()) return null;
    return claim;
  }

  async denyBotClaim(input: { claimId: string; flockId: string }): Promise<void> {
    await this.reloadIfRevisionChanged();
    const claim = this.botClaims.get(input.claimId);
    if (!claim || claim.flockId !== input.flockId) throw new PairCodeInvalid("mismatch");
    this.botClaims.set(claim.id, { ...claim, status: "denied" });
    await this.persist();
  }

  async approveBotClaim(input: {
    claimId: string;
    flockId: string;
    computerId: string;
    botLabel: string;
  }): Promise<BotClaim> {
    await this.reloadIfRevisionChanged();
    const claim = this.botClaims.get(input.claimId);
    if (!claim || claim.flockId !== input.flockId) throw new PairCodeInvalid("mismatch");
    if (claim.status === "redeemed" || claim.status === "denied") throw new PairCodeInvalid(claim.status);
    if (claim.expiresAt.getTime() <= this.now()) throw new PairCodeInvalid("expired");
    const label = input.botLabel.trim();
    if (label.length < 1 || label.length > 40) throw new PairCodeInvalid("bot label");
    const computer = await this.get(input.computerId);
    if (computer.state === "deleted" || computer.flockId !== input.flockId) {
      throw new PairCodeInvalid("computer");
    }
    const next: BotClaim = {
      ...claim,
      status: "approved",
      computerId: computer.id,
      botLabel: label,
      expiresAt: new Date(this.now() + ComputerService.BOT_CLAIM_TTL_MS),
    };
    this.botClaims.set(claim.id, next);
    await this.persist();
    return next;
  }

  async setClaimCheckoutNonce(input: {
    claimId: string;
    flockId: string;
    nonce: string;
    botLabel: string;
  }): Promise<void> {
    await this.reloadIfRevisionChanged();
    const claim = this.botClaims.get(input.claimId);
    if (!claim || claim.flockId !== input.flockId) throw new PairCodeInvalid("mismatch");
    if (claim.status === "redeemed" || claim.status === "denied") throw new PairCodeInvalid(claim.status);
    if (claim.expiresAt.getTime() <= this.now()) throw new PairCodeInvalid("expired");
    const label = input.botLabel.trim();
    if (label.length < 1 || label.length > 40) throw new PairCodeInvalid("bot label");
    this.botClaims.set(claim.id, {
      ...claim,
      checkoutNonce: input.nonce,
      botLabel: label,
      expiresAt: new Date(this.now() + ComputerService.BOT_CHECKOUT_TTL_MS),
    });
    await this.persist();
  }

  async attachPurchaseToClaim(checkoutNonce: string, computerId: string): Promise<boolean> {
    await this.reloadIfRevisionChanged();
    const claim = [...this.botClaims.values()].find((row) => row.checkoutNonce === checkoutNonce);
    if (!claim || claim.status === "denied" || claim.status === "redeemed") return false;
    if (claim.expiresAt.getTime() <= this.now()) return false;
    const label = claim.botLabel?.trim() ?? "";
    if (label.length < 1 || label.length > 40) return false;
    const computer = this.computers.get(computerId);
    if (!computer || computer.state === "deleted" || computer.flockId !== claim.flockId) return false;
    if (this.liveBotKey(computerId)) return false;
    this.botClaims.set(claim.id, {
      ...claim,
      status: "approved",
      computerId,
      botLabel: label,
      expiresAt: new Date(this.now() + ComputerService.BOT_CHECKOUT_TTL_MS),
    });
    await this.persist();
    return true;
  }

  liveBotKey(computerId: string): { botLabel: string; lastUsedAt: Date | null } | null {
    for (const cap of this.capabilities.values()) {
      if (cap.computerId !== computerId || !cap.botLabel) continue;
      if (cap.revokedAt !== null || cap.expiresAt.getTime() <= this.now()) continue;
      return { botLabel: cap.botLabel, lastUsedAt: cap.lastUsedAt };
    }
    return null;
  }

  capabilityForToken(token: string): ComputerCapability | null {
    const id = this.capabilitiesByDigest.get(hashToken(token));
    if (!id) return null;
    return this.capabilities.get(id) ?? null;
  }

  /** In-memory hit, or one reload when another instance minted the key. */
  async findCapabilityForToken(token: string): Promise<ComputerCapability | null> {
    const hit = this.capabilityForToken(token);
    if (hit) return hit;
    await this.reloadIfRevisionChanged();
    return this.capabilityForToken(token);
  }

  /** Revision last loaded or saved. Safe to log; it is not a secret. */
  controlPlaneRevision(): number {
    return this.revision;
  }

  async redeemBotClaim(input: {
    code: string;
    flockId: string;
  }): Promise<
    | { pending: true; claimId: string; expiresAt: Date; checkoutOpen: boolean }
    | { pending: false; pair: PairResult; botLabel: string | null }
  > {
    for (let attempt = 0; ; attempt++) {
      if (attempt === 0) await this.reloadIfRevisionChanged();
      else await this.hydrate();
      const done = await this.redeemBotClaimOnce(input);
      if (done !== "stale") return done;
      if (attempt >= 4) throw new StaleControlPlane();
    }
  }

  private async redeemBotClaimOnce(input: {
    code: string;
    flockId: string;
  }): Promise<
    | "stale"
    | { pending: true; claimId: string; expiresAt: Date; checkoutOpen: boolean }
    | { pending: false; pair: PairResult; botLabel: string | null }
  > {
    const digest = hashPairCode(input.code);
    const id = this.botClaimsByDigest.get(digest);
    const claim = id ? this.botClaims.get(id) : undefined;
    if (!claim) throw new PairCodeInvalid("mismatch");
    const fail = async (reason: string): Promise<never> => {
      const next = { ...claim, attemptCount: claim.attemptCount + 1 };
      this.botClaims.set(claim.id, next);
      await this.persist();
      throw new PairCodeInvalid(reason);
    };
    if (claim.attemptCount >= 5) return fail("locked");
    if (claim.flockId !== input.flockId) return fail("flock");
    if (claim.expiresAt.getTime() <= this.now()) return fail("expired");
    if (claim.status === "denied" || claim.status === "redeemed") return fail(claim.status);
    if (claim.status === "pending" || !claim.computerId) {
      return {
        pending: true,
        claimId: claim.id,
        expiresAt: claim.expiresAt,
        checkoutOpen: claim.status === "pending" && claim.checkoutNonce !== null,
      };
    }
    const computer = this.computers.get(claim.computerId);
    if (!computer || computer.state === "deleted" || computer.flockId !== claim.flockId) {
      return fail("computer");
    }
    this.revokeAllForComputer(computer.id);
    const scopes = copyScopes(parseScopes(DEFAULT_PAIR_SCOPES));
    const minted = issueCapability(DEFAULT_CAPABILITY_TTL_MS);
    const cap: ComputerCapability = {
      id: newId(),
      computerId: computer.id,
      birdId: computer.birdId,
      flockId: computer.flockId,
      tokenDigest: minted.digest,
      scopes,
      issuedAt: minted.issuedAt,
      expiresAt: minted.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      botLabel: claim.botLabel,
    };
    this.capabilities.set(cap.id, cap);
    this.capabilitiesByDigest.set(cap.tokenDigest, cap.id);
    this.botClaims.set(claim.id, { ...claim, status: "redeemed" });
    try {
      await this.persistExact();
    } catch (err) {
      if (err instanceof StaleControlPlane) return "stale";
      throw err;
    }
    return {
      pending: false,
      botLabel: claim.botLabel,
      pair: {
        token: minted.token,
        capabilityId: cap.id,
        computerHandle: computer.id,
        nodeHandle: computer.birdId,
        flockId: computer.flockId,
        scopes: copyScopes(scopes),
        expiresAt: cap.expiresAt,
      },
    };
  }

  /**
   * Owner path after checkout. Mints a capability for a computer that already
   * belongs to this flock. Does not redeem a pair code. The raw token is
   * returned once and is not stored.
   */
  async issueBoundCapability(computerId: string, flockId: string): Promise<PairResult> {
    await this.reloadIfRevisionChanged();
    const computer = await this.get(computerId);
    if (computer.state === "deleted") throw new ComputerNotFound(computerId);
    if (computer.flockId !== flockId) throw new CapabilityInvalid("flock mismatch");
    this.revokeAllForComputer(computerId);
    const scopes = copyScopes(parseScopes(DEFAULT_PAIR_SCOPES));
    const minted = issueCapability(DEFAULT_CAPABILITY_TTL_MS);
    const cap: ComputerCapability = {
      id: newId(),
      computerId: computer.id,
      birdId: computer.birdId,
      flockId: computer.flockId,
      tokenDigest: minted.digest,
      scopes,
      issuedAt: minted.issuedAt,
      expiresAt: minted.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.capabilities.set(cap.id, cap);
    this.capabilitiesByDigest.set(cap.tokenDigest, cap.id);
    await this.persist();
    return {
      token: minted.token,
      capabilityId: cap.id,
      computerHandle: computer.id,
      nodeHandle: computer.birdId,
      flockId: computer.flockId,
      scopes: copyScopes(scopes),
      expiresAt: cap.expiresAt,
    };
  }

  /** Drop every capability and unused pair code on this computer. */
  async revokeBoundComputer(computerId: string): Promise<void> {
    await this.reloadIfRevisionChanged();
    await this.get(computerId);
    this.revokeAllForComputer(computerId);
    await this.persist();
  }

  /**
   * Refresh path. Fails when the capability is revoked or expired, or the
   * computer is gone or no longer in this flock.
   */
  async extendBoundCapability(capabilityId: string, flockId: string): Promise<boolean> {
    try {
      await this.reloadIfRevisionChanged();
      const { capability } = this.authorize(
        { kind: "bound", capabilityId, flockId },
        "",
        "status",
      );
      this.capabilities.set(capability.id, {
        ...capability,
        scopes: copyScopes(capability.scopes),
        expiresAt: new Date(this.now() + DEFAULT_CAPABILITY_TTL_MS),
      });
      await this.persist();
      return true;
    } catch {
      return false;
    }
  }

  async revokeCapability(capabilityId: string): Promise<void> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) throw new CapabilityInvalid("not found");
    if (cap.revokedAt !== null) return;
    this.capabilities.set(capabilityId, {
      ...cap,
      scopes: copyScopes(cap.scopes),
      revokedAt: new Date(),
    });
    await this.persist();
  }

  /** Stored capability (digest only). Never contains the raw token. */
  getCapability(capabilityId: string): ComputerCapability {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) throw new CapabilityInvalid("not found");
    return { ...cap, scopes: copyScopes(cap.scopes) };
  }

  /** Stored pair-code record (digest only). Never contains the raw code. */
  getPairCode(pairCodeId: string): ComputerPairCode {
    const rec = this.pairCodes.get(pairCodeId);
    if (!rec) throw new PairCodeInvalid("not found");
    return rec;
  }

  /**
   * If the vendor machine is suspended or shut down, resume it or replace it
   * and wait until it is up. Running time stays billable. A refused seat is
   * left down.
   */
  private async ensureAwake(computer: Computer): Promise<Computer> {
    if (this.keyRenewed) {
      this.keyRenewed = false;
      await this.persist();
    }
    if (computer.state === "deleted" || computer.state === "deleting") {
      throw new ComputerNotFound(computer.id);
    }
    if (!computer.providerRef) return computer;
    if ((await this.classifyProvider(computer.providerRef)) === "up") {
      return this.healToUp(computer);
    }
    return this.enqueueDestroy(computer.id, () => this.ensureAwakeLocked(computer.id));
  }

  /** Move a stored state onto an already-running provider. Does not call pause/stop/wake. */
  private async healToUp(computer: Computer): Promise<Computer> {
    if (
      computer.state === "ready" ||
      computer.state === "running" ||
      computer.state === "error" ||
      computer.state === "deleting" ||
      computer.state === "deleted"
    ) {
      return computer;
    }
    const steps: ComputerState[] =
      computer.state === "recovery_failed"
        ? ["waking", "ready"]
        : computer.state === "paused"
          ? ["running"]
          : computer.state === "waking" || computer.state === "stopped" || computer.state === "provisioning"
            ? ["ready"]
            : [];
    let current = computer;
    for (const to of steps) {
      if (!canTransition(current.state, to)) return current;
      current = this.applyTransition(current, to);
    }
    if (current.state !== computer.state) await this.persist();
    return current;
  }

  private wakeBudgetMs(): number {
    const cap = Number(process.env.FLOK_WAKE_CALL_BUDGET_MS) || 45_000;
    return Math.min(this.wakeTimeoutMs, cap);
  }

  private async ensureAwakeLocked(computerId: string): Promise<Computer> {
    let computer = await this.get(computerId);
    const ref = computer.providerRef;
    if (!ref) return computer;
    if (computer.state === "deleted" || computer.state === "deleting") {
      throw new ComputerNotFound(computer.id);
    }
    const kind = await this.classifyProvider(ref);
    if (kind === "up") return this.healToUp(computer);
    if (!(await this.wakeAdmission(computer.id))) throw new ComputerAsleep();
    const deadline = this.now() + this.wakeBudgetMs();
    computer = this.markWaking(computer);
    await this.persist();
    let liveRef = computer.providerRef ?? ref;
    if (kind === "asleep") {
      try {
        await this.withinDeadline(this.provider.wake(liveRef), deadline);
      } catch (err) {
        if (err instanceof ComputerStarting || !this.shouldReplaceDevbox(err)) throw err;
        const latest = await this.get(computer.id);
        if (latest.rebuildConfirmRequired) {
          await this.refuseRebuildWithoutConfirm(latest, "rebuild");
        }
        computer = await this.replaceDevbox(latest);
        this.axByComputer.delete(computer.id);
        await this.healToUp(await this.get(computer.id));
        this.recordOperatorEvent({
          computerId: computer.id,
          birdId: computer.birdId,
          kind: "cleanup",
          operation: "rebuild",
          success: false,
          errorCode: "COMPUTER_REBUILT",
        });
        throw new ComputerRebuilt();
      }
    }
    await this.withinDeadline(this.pollUntilUp(liveRef, deadline), deadline);
    const latest = await this.get(computer.id);
    if (latest.state !== "ready" && latest.state !== "running") {
      return this.healToUp(latest);
    }
    return latest;
  }

  private markWaking(computer: Computer): Computer {
    let current = computer;
    if (current.state === "ready" || current.state === "running") {
      current = this.applyTransition(current, "stopped");
    }
    if (
      current.state === "paused" ||
      current.state === "stopped" ||
      current.state === "recovery_failed"
    ) {
      current = this.applyTransition(current, "waking");
    }
    return current;
  }

  private async classifyProvider(ref: string): Promise<"up" | "asleep" | "starting"> {
    try {
      const status = await this.provider.status(ref);
      if (status.state === "ready" || status.state === "running") return "up";
      if (
        status.state === "paused" ||
        status.state === "stopped" ||
        status.state === "deleted" ||
        status.state === "error"
      ) {
        return "asleep";
      }
      return "starting";
    } catch {
      return "asleep";
    }
  }

  private shouldReplaceDevbox(err: unknown): boolean {
    if (err instanceof ProviderNeedsReplacement) return true;
    const message = err instanceof Error ? err.message : "";
    return /DEVBOX_SHUTDOWN|cannot resume/i.test(message);
  }

  /**
   * Park a refused wake on a non-billable stopped box before REBUILD_CONFIRM_REQUIRED.
   * Never leave `waking` — that state cannot pause and used to block restart.
   */
  private async parkStoppedPendingRebuild(computerId: string): Promise<Computer> {
    const current = await this.get(computerId);
    const parked =
      current.state !== "stopped" && canTransition(current.state, "stopped")
        ? this.applyTransition(current, "stopped")
        : current;
    return this.patchComputer(parked.id, { rebuildConfirmRequired: true });
  }

  private async refuseRebuildWithoutConfirm(
    computer: Computer,
    operation: string,
  ): Promise<never> {
    await this.parkStoppedPendingRebuild(computer.id);
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "lifecycle",
      operation,
      success: false,
      errorCode: "REBUILD_CONFIRM_REQUIRED",
    });
    throw new RebuildConfirmRequired();
  }

  private async replaceDevbox(
    computer: Computer,
    opts?: { ownerConfirmed?: boolean },
  ): Promise<Computer> {
    if (computer.rebuildConfirmRequired && opts?.ownerConfirmed !== true) {
      await this.parkStoppedPendingRebuild(computer.id);
      throw new RebuildConfirmRequired();
    }
    const oldRef = computer.providerRef;
    const created = await this.provider.provision({
      birdId: computer.birdId,
      flockId: computer.flockId,
      osType: computer.osType,
      ...(computer.computerClass ? { computerClass: computer.computerClass } : {}),
      ...(computer.cpu !== null ? { cpu: computer.cpu } : {}),
      ...(computer.memoryMb !== null ? { memoryMb: computer.memoryMb } : {}),
      ...(computer.diskGb !== null ? { diskGb: computer.diskGb } : {}),
      ...(computer.baseImageVersion ? { baseImageVersion: computer.baseImageVersion } : {}),
    });
    const updated = await this.patchComputer(computer.id, {
      providerRef: created.providerRef,
      rebuildConfirmRequired: false,
    });
    if (oldRef && oldRef !== created.providerRef) {
      await this.provider.destroy(oldRef).catch(() => undefined);
    }
    return updated;
  }

  private async observeWhenReady(ref: string, request: ObserveRequest): Promise<Observation> {
    if (request.includeAccessibility !== true) {
      return this.provider.observe(ref, request);
    }
    const deadline = this.now() + 20_000;
    for (;;) {
      try {
        const observation = await this.provider.observe(ref, request);
        if (observation.accessibilitySummary !== undefined) return observation;
      } catch (err) {
        if (!(err instanceof ComputerUseNotAvailable) && !(err instanceof ProviderUnavailable)) throw err;
      }
      if (this.now() >= deadline) break;
      await this.sleepFn(Math.min(500, Math.max(0, deadline - this.now())));
    }
    const shot = await this.provider.observe(ref, { ...request, includeAccessibility: false });
    if (shot.screenshotBase64) return { ...shot, accessibilityPending: true };
    throw new ObserveRetryable("starting");
  }

  private async pollUntilUp(ref: string, deadline: number): Promise<void> {
    let delay = 500;
    for (;;) {
      if ((await this.classifyProvider(ref)) === "up") return;
      if (this.now() >= deadline) throw new ComputerStarting();
      const wait = Math.min(delay, deadline - this.now());
      await this.sleepFn(wait);
      delay = Math.min(delay * 2, 2_000);
    }
  }

  private withinDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - this.now();
    if (remaining <= 0) return Promise.reject(new ComputerStarting());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ComputerStarting()), remaining);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async status(auth: ComputerOperationAuth, computerId: string): Promise<ComputerStatus> {
    await this.reloadIfRevisionChanged();
    const authorized = this.authorize(auth, computerId, "status");
    const computer = await this.ensureAwake(authorized.computer);
    const result: ComputerStatus = { state: computer.state };
    if (computer.lastActiveAt !== null) {
      result.lastActiveAt = computer.lastActiveAt;
    }
    if (computer.providerRef) {
      const providerStatus = await this.provider.status(computer.providerRef);
      if (providerStatus.lastActiveAt !== undefined) {
        result.lastActiveAt = providerStatus.lastActiveAt;
      }
      if (providerStatus.providerDetail !== undefined) {
        result.providerDetail = providerStatus.providerDetail;
      }
    }
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "status",
      operation: "status",
      success: true,
      errorCode: null,
    });
    return result;
  }

  async exec(
    auth: ComputerOperationAuth,
    computerId: string,
    request: ExecRequest,
  ): Promise<ExecResult> {
    await this.reloadIfRevisionChanged();
    // Validate request at service boundary (schema-level enforcement)
    const validatedRequest = ExecRequestSchema.parse(request) as ExecRequest;

    const required: CapabilityScope[] =
      validatedRequest.mode === "shell" ? ["exec", "shell"] : ["exec"];
    const authorized = this.authorize(auth, computerId, required);
    const computer = await this.ensureAwake(authorized.computer);
    const ref = this.requireProviderRef(computer);
    await this.touch(computer);
    const root = workspaceRootForProvider(computer.provider);
    try {
      const cwd =
        validatedRequest.cwd !== undefined
          ? canonicalizeWorkspacePath(validatedRequest.cwd, root)
          : undefined;
      const execResult = await this.provider.exec(
        ref,
        cwd !== undefined ? { ...validatedRequest, cwd } : validatedRequest,
      );
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "exec",
        operation: "exec",
        success: execResult.exitCode === 0 && !execResult.timedOut,
        errorCode: execResult.timedOut ? "TIMEOUT" : execResult.exitCode === 0 ? null : "EXEC_FAILED",
      });
      return execResult;
    } catch (err) {
      if (err instanceof PathEscape) {
        this.recordOperatorEvent({
          computerId: computer.id,
          birdId: computer.birdId,
          kind: "exec",
          operation: "exec",
          success: false,
          errorCode: "PATH_ESCAPE",
        });
        return {
          exitCode: 126,
          stdout: "",
          stderr: `PATH_ESCAPE: cwd escapes workspace: ${validatedRequest.cwd}`,
          timedOut: false,
        };
      }
      throw err;
    }
  }

  async filesystem(
    auth: ComputerOperationAuth,
    computerId: string,
    request: FsRequest,
  ): Promise<FsResult> {
    await this.reloadIfRevisionChanged();
    const validatedRequest = FsRequestSchema.parse(request) as FsRequest;
    const authorized = this.authorize(auth, computerId, "fs");
    const computer = await this.ensureAwake(authorized.computer);
    const ref = this.requireProviderRef(computer);
    await this.touch(computer);
    const root = workspaceRootForProvider(computer.provider);
    try {
      const path = canonicalizeWorkspacePath(validatedRequest.path, root);
      const destination =
        validatedRequest.destination !== undefined
          ? canonicalizeWorkspacePath(validatedRequest.destination, root)
          : undefined;
      const fsResult = await this.provider.filesystem(ref, {
        ...validatedRequest,
        path,
        ...(destination !== undefined ? { destination } : {}),
      });
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "file",
        operation: `fs:${validatedRequest.operation}`,
        success: fsResult.ok,
        errorCode: fsResult.errorCode ?? null,
      });
      return fsResult;
    } catch (err) {
      if (err instanceof PathEscape) {
        this.recordOperatorEvent({
          computerId: computer.id,
          birdId: computer.birdId,
          kind: "file",
          operation: `fs:${validatedRequest.operation}`,
          success: false,
          errorCode: "PATH_ESCAPE",
        });
        return { ok: false, errorCode: "PATH_ESCAPE" };
      }
      throw err;
    }
  }

  async observe(
    auth: ComputerOperationAuth,
    computerId: string,
    request: ObserveRequest,
  ): Promise<Observation> {
    await this.reloadIfRevisionChanged();
    const authorized = this.authorize(auth, computerId, "observe");
    const computer = await this.ensureAwake(authorized.computer);
    const ref = this.requireProviderRef(computer);
    const live = await this.classifyProvider(ref);
    if (live !== "up") throw new ObserveRetryable(live);
    await this.touch(computer);
    const observation = await this.observeWhenReady(ref, request);
    if (request.includeAccessibility === true && !observation.accessibilityPending) {
      const cache = axCacheFromObservation(observation, this.now());
      if (cache) this.axByComputer.set(computer.id, cache);
      else this.axByComputer.delete(computer.id);
    }
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "observe",
      operation: "observe",
      success: true,
      errorCode: null,
    });
    return observation;
  }

  async act(
    auth: ComputerOperationAuth,
    computerId: string,
    request: ActionBatch,
  ): Promise<ActionResult> {
    await this.reloadIfRevisionChanged();
    const authorized = this.authorize(auth, computerId, "act");
    const computer = await this.ensureAwake(authorized.computer);
    const ref = this.requireProviderRef(computer);
    await this.touch(computer);
    const slots = rewriteActSlots(
      request.actions,
      this.axByComputer.get(computer.id) ?? null,
      this.now(),
    );
    const forwarded = slots.filter((slot) => slot.kind === "forward").map((slot) => slot.action);
    if (forwarded.length === 0) {
      const stitched = stitchActResults(slots, []);
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "fail-closed",
        operation: "click_element",
        success: false,
        errorCode: stitched.failCode ?? "ELEMENT_STALE",
      });
      return { ok: false, results: stitched.results };
    }
    const actResult = await this.provider.act(ref, { actions: forwarded });
    const stitched = stitchActResults(slots, actResult.results);
    if (actResult.results.some((row) => row.success)) {
      this.axByComputer.delete(computer.id);
    }
    const ok = stitched.results.every((row) => row.success);
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: stitched.failClosed ? "fail-closed" : "browser",
      operation: stitched.failClosed ? "click_element" : "act",
      success: ok,
      errorCode: stitched.failClosed ? (stitched.failCode ?? "ELEMENT_STALE") : null,
    });
    return { ok, results: stitched.results };
  }

  async wake(auth: ComputerOperationAuth, computerId: string): Promise<Computer> {
    await this.reloadIfRevisionChanged();
    this.authorize(auth, computerId, "lifecycle");
    return this.wakeThisComputer(computerId);
  }

  async pause(auth: ComputerOperationAuth, computerId: string): Promise<Computer> {
    await this.reloadIfRevisionChanged();
    this.authorize(auth, computerId, "lifecycle");
    return this.pauseThisComputer(computerId);
  }

  async pauseThisComputer(computerId: string): Promise<Computer> {
    return this.enqueueDestroy(computerId, () => this.pauseThisComputerLocked(computerId));
  }

  async stopThisComputer(computerId: string): Promise<Computer> {
    return this.enqueueDestroy(computerId, async () => {
      const current = await this.get(computerId);
      if (current.state === "stopped" || current.state === "deleted" || current.state === "deleting") {
        return current;
      }
      return this.transition(computerId, "stopped");
    });
  }

  async refreshKeepAlive(computerId: string): Promise<void> {
    const computer = await this.get(computerId);
    if (!computer.providerRef) return;
    if (this.provider.keepAlive) {
      await this.provider.keepAlive(computer.providerRef);
    }
  }

  private async pauseThisComputerLocked(computerId: string): Promise<Computer> {
    const current = await this.get(computerId);
    if (current.state === "paused") return current;
    const paused = await this.transition(computerId, "paused");
    this.recordOperatorEvent({
      computerId: paused.id,
      birdId: paused.birdId,
      kind: "lifecycle",
      operation: "pause",
      success: true,
      errorCode: null,
    });
    return paused;
  }

  async wakeThisComputer(computerId: string): Promise<Computer> {
    return this.enqueueDestroy(computerId, () => this.wakeThisComputerLocked(computerId));
  }

  private async wakeThisComputerLocked(computerId: string): Promise<Computer> {
    const current = await this.get(computerId);
    if (current.state === "ready" || current.state === "running") return current;
    if (!(await this.wakeAdmission(current.id))) throw new ComputerAsleep();
    let computer = current.state === "waking" ? current : this.applyTransition(current, "waking");
    await this.persist();
    const ref = this.requireProviderRef(computer);
    try {
      await this.provider.wake(ref);
    } catch (err) {
      if (this.shouldReplaceDevbox(err)) {
        await this.refuseRebuildWithoutConfirm(computer, "wake");
      }
      computer = this.applyTransition(await this.get(computerId), "recovery_failed");
      await this.patchComputer(computer.id, {
        recoveryNote: "wake failed",
      });
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "lifecycle",
        operation: "wake",
        success: false,
        errorCode: "RECOVERY_FAILED",
      });
      throw new ComputerError("RECOVERY_FAILED", "wake failed");
    }
    try {
      await this.provider.healthProbe(ref);
    } catch (err) {
      if (this.shouldReplaceDevbox(err)) {
        await this.refuseRebuildWithoutConfirm(await this.get(computerId), "wake");
      }
      computer = this.applyTransition(await this.get(computerId), "recovery_failed");
      await this.patchComputer(computer.id, {
        recoveryNote: "wake health probe failed",
      });
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "lifecycle",
        operation: "wake",
        success: false,
        errorCode: "RECOVERY_FAILED",
      });
      throw new ComputerError("RECOVERY_FAILED", "wake health probe failed");
    }
    computer = this.applyTransition(await this.get(computerId), "ready");
    await this.patchComputer(computer.id, { recoveryNote: null, rebuildConfirmRequired: false });
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "lifecycle",
      operation: "wake",
      success: true,
      errorCode: null,
    });
    return await this.get(computerId);
  }

  /**
   * Owner reboot. Stop then wake so the disk stays when the provider can resume.
   * A rebuild that would wipe files requires confirmRebuild.
   */
  async restartThisComputer(
    computerId: string,
    opts?: { confirmRebuild?: boolean },
  ): Promise<Computer> {
    return this.enqueueDestroy(computerId, () =>
      this.restartThisComputerLocked(computerId, opts),
    );
  }

  private async restartThisComputerLocked(
    computerId: string,
    opts?: { confirmRebuild?: boolean },
  ): Promise<Computer> {
    let computer = await this.get(computerId);
    if (computer.state === "deleted" || computer.state === "deleting") {
      throw new ComputerNotFound(computerId);
    }
    if (!(await this.wakeAdmission(computer.id))) throw new ComputerAsleep();
    if (computer.state !== "stopped") {
      if (computer.state === "waking" || computer.state === "recovery_failed") {
        computer = this.applyTransition(computer, "stopped");
        await this.persist();
      } else if (canTransition(computer.state, "stopped")) {
        computer = await this.transition(computerId, "stopped");
      }
    }
    const ref = this.requireProviderRef(computer);
    try {
      await this.provider.wake(ref);
      await this.provider.healthProbe(ref);
    } catch (err) {
      if (this.shouldReplaceDevbox(err)) {
        if (opts?.confirmRebuild !== true) {
          await this.refuseRebuildWithoutConfirm(computer, "restart");
        }
        computer = await this.replaceDevbox(await this.get(computerId), { ownerConfirmed: true });
        this.axByComputer.delete(computer.id);
        await this.healToUp(computer);
        this.recordOperatorEvent({
          computerId: computer.id,
          birdId: computer.birdId,
          kind: "lifecycle",
          operation: "restart",
          success: true,
          errorCode: "COMPUTER_REBUILT",
        });
        return await this.get(computerId);
      }
      const failed = await this.get(computerId);
      if (canTransition(failed.state, "recovery_failed")) {
        this.applyTransition(failed, "recovery_failed");
        await this.patchComputer(failed.id, { recoveryNote: "restart failed" });
      }
      this.recordOperatorEvent({
        computerId,
        birdId: computer.birdId,
        kind: "lifecycle",
        operation: "restart",
        success: false,
        errorCode: err instanceof ComputerError ? err.code : "RESTART_FAILED",
      });
      throw err;
    }
    computer = await this.healToUp(await this.get(computerId));
    await this.patchComputer(computer.id, { recoveryNote: null, rebuildConfirmRequired: false });
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "lifecycle",
      operation: "restart",
      success: true,
      errorCode: null,
    });
    return await this.get(computerId);
  }

  async checkpointThisComputer(computerId: string): Promise<Computer> {
    return this.enqueueDestroy(computerId, () => this.checkpointThisComputerLocked(computerId));
  }

  private async checkpointThisComputerLocked(computerId: string): Promise<Computer> {
    const current = await this.get(computerId);
    if (!this.provider.capabilities().snapshots) {
      throw new RestoreUnsupported(this.provider.name);
    }
    const from = current.state;
    const ref = this.requireProviderRef(current);
    let computer = this.applyTransition(current, "checkpointing");
    const pending: ComputerLatestCheckpoint = {
      id: newId(),
      providerSnapshotRef: "pending",
      createdAt: new Date(this.now()),
      status: "pending",
    };
    computer = { ...computer, latestCheckpoint: pending, recoveryNote: null };
    this.computers.set(computer.id, computer);
    await this.persist();
    try {
      const snap = await this.provider.checkpoint(ref);
      const ready: ComputerLatestCheckpoint = {
        id: pending.id,
        providerSnapshotRef: snap.providerSnapshotRef,
        createdAt: pending.createdAt,
        status: "ready",
      };
      const resumeTo: ComputerState =
        from === "paused" || from === "running" || from === "ready" ? from : "ready";
      this.applyTransition(await this.get(computerId), resumeTo);
      computer = await this.patchComputer(computerId, { latestCheckpoint: ready });
      this.recordOperatorEvent({
        computerId: computer.id,
        birdId: computer.birdId,
        kind: "status",
        operation: "checkpoint",
        success: true,
        errorCode: null,
      });
      return computer;
    } catch (err) {
      const failed: ComputerLatestCheckpoint = {
        ...pending,
        status: "failed",
      };
      const resumeTo: ComputerState =
        from === "paused" || from === "running" || from === "ready" ? from : "error";
      if (canTransition("checkpointing", resumeTo)) {
        this.applyTransition(await this.get(computerId), resumeTo);
      }
      await this.patchComputer(computerId, {
        latestCheckpoint: failed,
        recoveryNote: "checkpoint failed",
      });
      this.recordOperatorEvent({
        computerId,
        birdId: current.birdId,
        kind: "status",
        operation: "checkpoint",
        success: false,
        errorCode: "CHECKPOINT_FAILED",
      });
      throw err;
    }
  }

  async recoverThisComputer(computerId: string): Promise<Computer> {
    return this.enqueueDestroy(computerId, () => this.recoverThisComputerLocked(computerId));
  }

  private async abortRecovery(
    computerId: string,
    birdId: string,
    latest: ComputerLatestCheckpoint,
    priorStatus: "ready" | "restored",
    failedState: "restore_failed" | "recovery_failed",
    note: string,
    errorCode: string,
  ): Promise<void> {
    const live = await this.get(computerId);
    if (live.state === "recovering" && canTransition(live.state, failedState)) {
      this.applyTransition(live, failedState);
    }
    await this.patchComputer(computerId, {
      latestCheckpoint: { ...latest, status: priorStatus },
      recoveryNote: note,
    });
    this.recordOperatorEvent({
      computerId,
      birdId,
      kind: "cleanup",
      operation: "recover",
      success: false,
      errorCode,
    });
  }

  private async recoverThisComputerLocked(computerId: string): Promise<Computer> {
    const current = await this.get(computerId);
    const latest = current.latestCheckpoint;
    if (!latest || (latest.status !== "ready" && latest.status !== "restored")) {
      throw new CheckpointRequired();
    }
    if (!this.provider.capabilities().snapshots) {
      throw new RestoreUnsupported(this.provider.name);
    }
    const priorStatus: "ready" | "restored" =
      latest.status === "restored" ? "restored" : "ready";
    let computer = this.applyTransition(current, "recovering");
    computer = {
      ...computer,
      latestCheckpoint: { ...latest, status: "restoring" },
      recoveryNote: null,
    };
    this.computers.set(computer.id, computer);
    await this.persist();

    const oldRef = computer.providerRef;

    let restoredRef: string;
    try {
      const restored = await this.provider.restore({
        computerId,
        checkpointId: latest.id,
        providerSnapshotRef: latest.providerSnapshotRef,
        birdId: current.birdId,
        flockId: current.flockId,
      });
      restoredRef = restored.providerRef;
      await this.patchComputer(computerId, { providerRef: restoredRef });
    } catch (err) {
      await this.abortRecovery(
        computerId,
        current.birdId,
        latest,
        priorStatus,
        "restore_failed",
        "restore failed",
        err instanceof RestoreUnsupported ? "RESTORE_UNSUPPORTED" : "RESTORE_FAILED",
      );
      if (err instanceof RestoreUnsupported) throw err;
      throw new ComputerError("RESTORE_FAILED", "restore failed");
    }

    try {
      await this.provider.healthProbe(restoredRef);
    } catch {
      await this.provider.destroy(restoredRef).catch(() => undefined);
      if (oldRef) {
        await this.patchComputer(computerId, { providerRef: oldRef });
      }
      await this.abortRecovery(
        computerId,
        current.birdId,
        latest,
        priorStatus,
        "recovery_failed",
        "health probe failed after restore",
        "RECOVERY_FAILED",
      );
      throw new ComputerError("RECOVERY_FAILED", "health probe failed after restore");
    }

    if (oldRef && oldRef !== restoredRef) {
      try {
        await this.provider.destroy(oldRef);
      } catch {
        this.applyTransition(await this.get(computerId), "ready");
        await this.patchComputer(computerId, {
          latestCheckpoint: { ...latest, status: "restored" },
          recoveryNote:
            "replacement ready; previous VM destroy failed — retry cleanup with captured providerRef",
        });
        this.recordOperatorEvent({
          computerId,
          birdId: current.birdId,
          kind: "cleanup",
          operation: "recover-destroy",
          success: false,
          errorCode: "CLEANUP_FAILED",
        });
        return this.get(computerId);
      }
    }

    const restoredCheckpoint: ComputerLatestCheckpoint = {
      ...latest,
      status: "restored",
    };
    this.axByComputer.delete(computerId);
    this.applyTransition(await this.get(computerId), "ready");
    computer = await this.patchComputer(computerId, {
      latestCheckpoint: restoredCheckpoint,
      recoveryNote: null,
    });
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: "cleanup",
      operation: "recover",
      success: true,
      errorCode: null,
    });
    return computer;
  }

  async stop(auth: ComputerOperationAuth, computerId: string): Promise<Computer> {
    await this.reloadIfRevisionChanged();
    this.authorize(auth, computerId, "lifecycle");
    return this.transition(computerId, "stopped");
  }

  private authorizeBound(
    auth: { kind: "bound"; capabilityId: string; flockId: string },
    required: CapabilityScope | readonly CapabilityScope[],
  ): { computer: Computer; capability: ComputerCapability } {
    const capability = this.capabilities.get(auth.capabilityId);
    if (!capability) throw new CapabilityMissing("missing capability");
    if (capability.revokedAt !== null) throw new CapabilityRevoked(capability.id);
    if (capability.expiresAt.getTime() <= this.now()) throw new CapabilityExpired(capability.id);
    const computer = this.computers.get(capability.computerId);
    if (!computer || computer.state === "deleted") {
      throw new ComputerNotFound(capability.computerId);
    }
    if (computer.flockId !== auth.flockId || capability.flockId !== auth.flockId) {
      throw new CapabilityInvalid("flock mismatch");
    }
    const needed = typeof required === "string" ? [required] : [...required];
    for (const scope of needed) {
      if (!hasScope(capability.scopes, scope)) {
        throw new InsufficientScope(scope, capability.scopes);
      }
    }
    const touched = this.maybeRenew({
      ...capability,
      scopes: copyScopes(capability.scopes),
      lastUsedAt: new Date(this.now()),
    });
    this.capabilities.set(capability.id, touched);
    return { computer, capability: touched };
  }

  private authorize(
    auth: ComputerOperationAuth,
    computerId: string,
    required: CapabilityScope | readonly CapabilityScope[],
  ): { computer: Computer; capability: ComputerCapability } {
    if (auth.kind === "bound") return this.authorizeBound(auth, required);
    const token = extractCapabilityToken(auth);
    const digest = hashToken(token);
    const capId = this.capabilitiesByDigest.get(digest);
    if (!capId) {
      throw new CapabilityInvalid("mismatch");
    }
    const capability = this.capabilities.get(capId);
    if (!capability) {
      throw new CapabilityInvalid("mismatch");
    }
    const computer = this.computers.get(computerId);
    const record = toCapabilityRecord(capability);
    const expected = {
      computerId,
      birdId: computer?.birdId ?? capability.birdId,
      flockId: computer?.flockId ?? capability.flockId,
    };
    const needed = typeof required === "string" ? [required] : [...required];
    if (needed.length === 0) {
      isCapabilityValid(token, record, expected);
    } else {
      for (const scope of needed) {
        isCapabilityValid(token, record, { ...expected, scope });
      }
    }
    if (!computer || computer.state === "deleted") {
      throw new ComputerNotFound(computerId);
    }
    const touched = this.maybeRenew({
      ...capability,
      scopes: copyScopes(capability.scopes),
      lastUsedAt: new Date(this.now()),
    });
    this.capabilities.set(capability.id, touched);
    return { computer, capability: touched };
  }

  private requireProviderRef(computer: Computer): string {
    if (!computer.providerRef) {
      throw new ComputerNotFound(computer.id);
    }
    return computer.providerRef;
  }

  private async touch(computer: Computer): Promise<void> {
    const updated: Computer = {
      ...computer,
      lastActiveAt: new Date(this.now()),
      updatedAt: new Date(this.now()),
    };
    this.computers.set(computer.id, updated);
    await this.persist();
  }

  private revokeAllForComputer(computerId: string): void {
    const now = new Date();
    for (const [id, cap] of this.capabilities) {
      if (cap.computerId === computerId && cap.revokedAt === null) {
        this.capabilities.set(id, {
          ...cap,
          scopes: copyScopes(cap.scopes),
          revokedAt: now,
        });
      }
    }
    for (const [id, rec] of this.pairCodes) {
      if (rec.computerId === computerId && rec.usedAt === null) {
        this.pairCodes.set(id, { ...rec, usedAt: now });
      }
    }
  }

  private assertPairRateLimit(identity: NodeIdentity): void {
    const cur = this.pairFailuresByIdentity.get(identityKey(identity));
    if (
      cur &&
      Date.now() - cur.windowStart <= PAIR_FAILURE_WINDOW_MS &&
      cur.count >= PAIR_IDENTITY_FAILURE_LIMIT
    ) {
      throw new PairCodeInvalid("too many attempts");
    }
  }

  private notePairFailure(identity: NodeIdentity): void {
    const key = identityKey(identity);
    const now = Date.now();
    const cur = this.pairFailuresByIdentity.get(key);
    if (!cur || now - cur.windowStart > PAIR_FAILURE_WINDOW_MS) {
      this.pairFailuresByIdentity.set(key, { count: 1, windowStart: now });
    } else {
      cur.count += 1;
    }
    void this.persist();
  }

  private sweepPairState(now = Date.now()): void {
    for (const [key, win] of this.pairFailuresByIdentity) {
      if (now - win.windowStart > PAIR_FAILURE_WINDOW_MS) {
        this.pairFailuresByIdentity.delete(key);
      }
    }
    for (const [id, rec] of this.pairCodes) {
      if (rec.usedAt !== null && rec.expiresAt.getTime() <= now) {
        this.pairCodes.delete(id);
        this.pairCodesByDigest.delete(rec.codeDigest);
        this.pairIssueExtras.delete(id);
      }
    }
  }

  private recordOperatorEvent(input: {
    computerId: string | null;
    birdId: string | null;
    kind: OperatorEventKind;
    operation: string;
    success: boolean;
    errorCode: string | null;
  }): void {
    const event: OperatorEvent = {
      id: newId(),
      at: new Date(this.now()).toISOString(),
      computerId: input.computerId,
      birdId: input.birdId,
      kind: input.kind,
      operation: input.operation,
      success: input.success,
      errorCode: input.errorCode,
    };
    this.operatorEvents.push(event);
    if (this.operatorEvents.length > OPERATOR_EVENT_CAP) {
      this.operatorEvents.splice(0, this.operatorEvents.length - OPERATOR_EVENT_CAP);
    }
    if (!this.activityStore || input.kind === "status") return;
    const store = this.activityStore;
    this.activityPersist = this.activityPersist
      .catch(() => undefined)
      .then(async () => {
        try {
          await store.append(toActivityEvent(event));
          if (Math.floor(this.now() / 1000) % 17 === 0) {
            await store.purgeExpired(this.now()).catch(() => 0);
          }
        } catch {
          /* durable log must not fail the computer action */
        }
      });
  }

  pairStatus(computerId: string): OperatorPairStatus {
    return this.pairStatusFor(computerId);
  }

  private pairStatusFor(computerId: string): OperatorPairStatus {
    const now = Date.now();
    for (const cap of this.capabilities.values()) {
      if (
        cap.computerId === computerId &&
        cap.revokedAt === null &&
        cap.expiresAt.getTime() > now
      ) {
        return "paired";
      }
    }
    for (const rec of this.pairCodes.values()) {
      if (
        rec.computerId === computerId &&
        rec.usedAt === null &&
        rec.expiresAt.getTime() > now
      ) {
        return "pairing";
      }
    }
    return "unpaired";
  }

  private scopesFor(computerId: string): {
    scopes: CapabilityScope[];
    expiresAt: Date | null;
  } {
    const now = Date.now();
    let latest: ComputerCapability | null = null;
    for (const cap of this.capabilities.values()) {
      if (
        cap.computerId !== computerId ||
        cap.revokedAt !== null ||
        cap.expiresAt.getTime() <= now
      ) {
        continue;
      }
      if (!latest || cap.issuedAt.getTime() > latest.issuedAt.getTime()) {
        latest = cap;
      }
    }
    if (!latest) return { scopes: [], expiresAt: null };
    return { scopes: copyScopes(latest.scopes), expiresAt: latest.expiresAt };
  }

  private lastActionFor(computerId: string): string | null {
    for (let i = this.operatorEvents.length - 1; i >= 0; i -= 1) {
      const ev = this.operatorEvents[i];
      if (ev && ev.computerId === computerId) return ev.operation;
    }
    return null;
  }

  private toOperatorObserve(observation: Observation): OperatorObserveResult {
    const screenshot = observation.screenshotBase64;
    const hasScreenshot = typeof screenshot === "string" && screenshot.length > 0;
    const result: OperatorObserveResult = {
      screenWidth: observation.screenWidth,
      screenHeight: observation.screenHeight,
      hasScreenshot,
      accessibility: summarizeAccessibility(observation.accessibilitySummary),
    };
    if (observation.activeWindow) result.activeWindow = observation.activeWindow;
    if (hasScreenshot && screenshot) result.screenshotBase64 = screenshot;
    return result;
  }
}

// Re-export the error so tests can import from one place if desired
export { IllegalStateTransition, DuplicateComputer, ComputerNotFound };
