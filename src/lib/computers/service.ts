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
 */

import { randomBytes } from "node:crypto";
import type { ComputerProvider } from "./providers/provider.js";
import type {
  ActionBatch,
  ActionResult,
  CapabilityScope,
  Computer,
  ComputerCapability,
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
  CapabilityExpired,
  CapabilityInvalid,
  CapabilityRevoked,
  ComputerNotFound,
  CrossNodeDenied,
  DuplicateComputer,
  IllegalStateTransition,
  InsufficientScope,
  PairCodeInvalid,
} from "./errors.js";
import { assertTransition } from "./state.js";
import {
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_PAIR_SCOPES,
  extractCapabilityToken,
  hashToken,
  hasScope,
  issueCapability,
  parseScopes,
} from "./capabilities.js";
import { digestEquals } from "./digest.js";
import {
  generatePairCode,
  hashPairCode,
  PAIR_CODE_TTL_MS,
  validatePairCode,
} from "./pairing.js";

function newId(): string {
  return randomBytes(16).toString("hex");
}

const PAIR_FAILURE_WINDOW_MS = PAIR_CODE_TTL_MS;
const PAIR_FAILURES_PER_ACCOUNT = 10;

interface PairIssueExtras {
  scopes: CapabilityScope[];
  capabilityTtlMs: number;
}

interface PairFailureWindow {
  count: number;
  windowStart: number;
}

export class ComputerService {
  private computers = new Map<string, Computer>();
  private byBird = new Map<string, string>(); // birdId → computerId
  private pairCodes = new Map<string, ComputerPairCode>();
  private pairCodesByDigest = new Map<string, string>();
  private pairIssueExtras = new Map<string, PairIssueExtras>();
  private capabilities = new Map<string, ComputerCapability>();
  private capabilitiesByDigest = new Map<string, string>();
  private pairFailuresByAccount = new Map<string, PairFailureWindow>();

  constructor(private readonly provider: ComputerProvider) {}

  /** Clear all in-memory state (test helper). */
  reset(): void {
    this.computers.clear();
    this.byBird.clear();
    this.pairCodes.clear();
    this.pairCodesByDigest.clear();
    this.pairIssueExtras.clear();
    this.capabilities.clear();
    this.capabilitiesByDigest.clear();
    this.pairFailuresByAccount.clear();
  }

  /**
   * Request a computer for a Node.
   * Enforces one-computer-per-birdId.
   * Calls provider.provision and records the resulting computer in state "ready".
   * Control-plane: does not issue a Bot capability. Pairing does that.
   */
  async requestComputer(spec: ComputerSpec): Promise<Computer> {
    if (this.byBird.has(spec.birdId)) {
      throw new DuplicateComputer(spec.birdId);
    }

    const now = new Date();
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
    };

    this.computers.set(id, computer);
    this.byBird.set(spec.birdId, id);

    // requested → provisioning
    computer = this.applyTransition(computer, "provisioning");

    // Call provider
    const provisioned = await this.provider.provision(spec);

    // provisioning → ready
    computer = {
      ...computer,
      providerRef: provisioned.providerRef,
      state: "ready",
      updatedAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.computers.set(id, computer);

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
    return updated;
  }

  private applyTransition(computer: Computer, to: ComputerState): Computer {
    assertTransition(computer.state, to);
    const updated: Computer = {
      ...computer,
      state: to,
      updatedAt: new Date(),
      lastActiveAt: to === "running" || to === "ready" ? new Date() : computer.lastActiveAt,
    };
    this.computers.set(computer.id, updated);
    if (to === "deleted") {
      this.byBird.delete(computer.birdId);
      this.revokeAllForComputer(computer.id);
    }
    return updated;
  }

  /** List all computers currently tracked (test / debug helper). */
  list(): Computer[] {
    return [...this.computers.values()];
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

    const now = new Date();
    for (const [id, rec] of this.pairCodes) {
      if (rec.computerId === computerId && rec.usedAt === null) {
        this.pairCodes.set(id, { ...rec, usedAt: now });
      }
    }

    const ttlMs = opts?.ttlMs ?? PAIR_CODE_TTL_MS;
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
    this.pairIssueExtras.set(record.id, {
      scopes: parseScopes(opts?.scopes ?? DEFAULT_PAIR_SCOPES),
      capabilityTtlMs: opts?.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS,
    });

    return { id: record.id, code: material.code, expiresAt: material.expiresAt };
  }

  /**
   * Redeem a pair code. Shared MCP auth may be attached (C5 will have it) but
   * does not authorize issuance — the one-time pair code does.
   * Returns a capability secret once. Only the digest is stored.
   */
  async pair(
    presentedCode: string,
    identity: NodeIdentity,
    sharedAuth?: SharedAccountAuth,
  ): Promise<PairResult> {
    if (sharedAuth) {
      this.assertPairRateLimit(sharedAuth.accountId);
    }

    const digest = hashPairCode(presentedCode);
    const id = this.pairCodesByDigest.get(digest);
    if (!id) {
      this.notePairFailure(sharedAuth?.accountId);
      throw new PairCodeInvalid("mismatch");
    }
    const record = this.pairCodes.get(id);
    if (!record) {
      this.notePairFailure(sharedAuth?.accountId);
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
      this.notePairFailure(sharedAuth?.accountId);
      throw err;
    }

    const computer = this.computers.get(record.computerId);
    if (!computer || computer.state === "deleted") {
      this.pairCodes.set(id, { ...record, attemptCount: record.attemptCount + 1 });
      throw new PairCodeInvalid("computer gone");
    }
    if (
      computer.birdId !== identity.birdId ||
      computer.flockId !== identity.flockId ||
      record.birdId !== identity.birdId ||
      record.flockId !== identity.flockId
    ) {
      this.pairCodes.set(id, { ...record, attemptCount: record.attemptCount + 1 });
      throw new PairCodeInvalid("identity mismatch");
    }

    const consumed: ComputerPairCode = { ...record, usedAt: new Date() };
    this.pairCodes.set(id, consumed);

    const extras = this.pairIssueExtras.get(id);
    const scopes = extras?.scopes ?? parseScopes(DEFAULT_PAIR_SCOPES);
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

    return {
      token: minted.token,
      capabilityId: cap.id,
      computerHandle: computer.id,
      nodeHandle: computer.birdId,
      flockId: computer.flockId,
      scopes: [...scopes],
      expiresAt: cap.expiresAt,
    };
  }

  async revokeCapability(capabilityId: string): Promise<void> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) throw new CapabilityInvalid("not found");
    if (cap.revokedAt !== null) return;
    this.capabilities.set(capabilityId, { ...cap, revokedAt: new Date() });
  }

  /** Stored capability (digest only). Never contains the raw token. */
  getCapability(capabilityId: string): ComputerCapability {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) throw new CapabilityInvalid("not found");
    return cap;
  }

  /** Stored pair-code record (digest only). Never contains the raw code. */
  getPairCode(pairCodeId: string): ComputerPairCode {
    const rec = this.pairCodes.get(pairCodeId);
    if (!rec) throw new PairCodeInvalid("not found");
    return rec;
  }

  async status(auth: ComputerOperationAuth, computerId: string): Promise<ComputerStatus> {
    const { computer } = this.authorize(auth, computerId, "status");
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
    return result;
  }

  async exec(
    auth: ComputerOperationAuth,
    computerId: string,
    request: ExecRequest,
  ): Promise<ExecResult> {
    const required: CapabilityScope[] =
      request.mode === "shell" ? ["exec", "shell"] : ["exec"];
    const { computer } = this.authorize(auth, computerId, required);
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
    return this.provider.exec(ref, request);
  }

  async filesystem(
    auth: ComputerOperationAuth,
    computerId: string,
    request: FsRequest,
  ): Promise<FsResult> {
    const { computer } = this.authorize(auth, computerId, "fs");
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
    return this.provider.filesystem(ref, request);
  }

  async observe(
    auth: ComputerOperationAuth,
    computerId: string,
    request: ObserveRequest,
  ): Promise<Observation> {
    const { computer } = this.authorize(auth, computerId, "observe");
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
    return this.provider.observe(ref, request);
  }

  async act(
    auth: ComputerOperationAuth,
    computerId: string,
    request: ActionBatch,
  ): Promise<ActionResult> {
    const { computer } = this.authorize(auth, computerId, "act");
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
    return this.provider.act(ref, request);
  }

  async wake(auth: ComputerOperationAuth, computerId: string): Promise<Computer> {
    this.authorize(auth, computerId, "lifecycle");
    const current = await this.get(computerId);
    if (current.state === "running") return current;
    return this.transition(computerId, "running");
  }

  async pause(auth: ComputerOperationAuth, computerId: string): Promise<Computer> {
    this.authorize(auth, computerId, "lifecycle");
    return this.transition(computerId, "paused");
  }

  async stop(auth: ComputerOperationAuth, computerId: string): Promise<Computer> {
    this.authorize(auth, computerId, "lifecycle");
    return this.transition(computerId, "stopped");
  }

  private authorize(
    auth: ComputerOperationAuth,
    computerId: string,
    required: CapabilityScope | readonly CapabilityScope[],
  ): { computer: Computer; capability: ComputerCapability } {
    const token = extractCapabilityToken(auth);
    const digest = hashToken(token);
    const capId = this.capabilitiesByDigest.get(digest);
    if (!capId) {
      throw new CapabilityInvalid("mismatch");
    }
    const capability = this.capabilities.get(capId);
    if (!capability || !digestEquals(capability.tokenDigest, digest)) {
      throw new CapabilityInvalid("mismatch");
    }
    if (capability.revokedAt !== null) {
      throw new CapabilityRevoked(capability.id);
    }
    if (Date.now() > capability.expiresAt.getTime()) {
      throw new CapabilityExpired(capability.id);
    }
    if (capability.computerId !== computerId) {
      throw new CrossNodeDenied(capability.computerId, computerId);
    }
    const computer = this.computers.get(computerId);
    if (!computer || computer.state === "deleted") {
      throw new ComputerNotFound(computerId);
    }
    if (capability.birdId !== computer.birdId || capability.flockId !== computer.flockId) {
      throw new CrossNodeDenied(capability.computerId, computerId);
    }
    const needed = typeof required === "string" ? [required] : [...required];
    for (const scope of needed) {
      if (!hasScope(capability.scopes, scope)) {
        throw new InsufficientScope(scope, capability.scopes);
      }
    }
    const touched: ComputerCapability = { ...capability, lastUsedAt: new Date() };
    this.capabilities.set(capability.id, touched);
    return { computer, capability: touched };
  }

  private requireProviderRef(computer: Computer): string {
    if (!computer.providerRef) {
      throw new ComputerNotFound(computer.id);
    }
    return computer.providerRef;
  }

  private touch(computer: Computer): void {
    const updated: Computer = {
      ...computer,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    };
    this.computers.set(computer.id, updated);
  }

  private revokeAllForComputer(computerId: string): void {
    const now = new Date();
    for (const [id, cap] of this.capabilities) {
      if (cap.computerId === computerId && cap.revokedAt === null) {
        this.capabilities.set(id, { ...cap, revokedAt: now });
      }
    }
    for (const [id, rec] of this.pairCodes) {
      if (rec.computerId === computerId && rec.usedAt === null) {
        this.pairCodes.set(id, { ...rec, usedAt: now });
      }
    }
  }

  private assertPairRateLimit(accountId: string): void {
    const cur = this.pairFailuresByAccount.get(accountId);
    if (
      cur &&
      Date.now() - cur.windowStart <= PAIR_FAILURE_WINDOW_MS &&
      cur.count >= PAIR_FAILURES_PER_ACCOUNT
    ) {
      throw new PairCodeInvalid("too many attempts");
    }
  }

  private notePairFailure(accountId: string | undefined): void {
    if (accountId === undefined) return;
    const now = Date.now();
    const cur = this.pairFailuresByAccount.get(accountId);
    if (!cur || now - cur.windowStart > PAIR_FAILURE_WINDOW_MS) {
      this.pairFailuresByAccount.set(accountId, { count: 1, windowStart: now });
      return;
    }
    cur.count += 1;
  }
}

// Re-export the error so tests can import from one place if desired
export { IllegalStateTransition, DuplicateComputer, ComputerNotFound };
