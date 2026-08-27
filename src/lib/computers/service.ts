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
  CapabilityInvalid,
  ComputerNotFound,
  DestroyConfirmRequired,
  DestroyProviderRefMismatch,
  DuplicateComputer,
  IllegalStateTransition,
  PairCodeInvalid,
  PathEscape,
} from "./errors.js";
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
import { assertTransition } from "./state.js";
import {
  copyScopes,
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_PAIR_SCOPES,
  extractCapabilityToken,
  hashToken,
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
import type { ControlPlaneStore, ControlPlaneSnapshot } from "./control-plane-store.js";
import {
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

export class ComputerService {
  private computers = new Map<string, Computer>();
  private byBird = new Map<string, string>(); // birdId → computerId
  private pairCodes = new Map<string, ComputerPairCode>();
  private pairCodesByDigest = new Map<string, string>();
  private pairIssueExtras = new Map<string, PairIssueExtras>();
  private capabilities = new Map<string, ComputerCapability>();
  private capabilitiesByDigest = new Map<string, string>();
  /** Keyed by presented bird+flock, never by shared MCP account id. */
  private pairFailuresByIdentity = new Map<string, PairFailureWindow>();
  private readonly store: ControlPlaneStore | undefined;
  private readonly ownerId: string | null;
  private readonly workspaceId: string | null;
  private persistChain: Promise<void> = Promise.resolve();
  private operatorEvents: OperatorEvent[] = [];

  constructor(
    private readonly provider: ComputerProvider,
    opts?: {
      store?: ControlPlaneStore;
      ownerId?: string | null;
      workspaceId?: string | null;
    },
  ) {
    this.store = opts?.store;
    this.ownerId = opts?.ownerId ?? null;
    this.workspaceId = opts?.workspaceId ?? null;
  }

  async hydrate(): Promise<void> {
    if (!this.store) return;
    const snap = await this.store.load();
    if (!snap) return;
    this.applySnapshot(snap);
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
  }

  private async persist(): Promise<void> {
    const store = this.store;
    if (!store) return;
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(() => store.save(this.toSnapshot()));
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
    this.pairFailuresByIdentity.clear();
    this.operatorEvents = [];
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
    await this.persist();

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

  listOperatorEvents(): OperatorEvent[] {
    return this.operatorEvents.map((e) => ({ ...e }));
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
    };
  }

  async operatorObserve(
    computerId: string,
    request: ObserveRequest,
  ): Promise<OperatorObserveResult> {
    const computer = await this.get(computerId);
    if (computer.state === "deleted") throw new ComputerNotFound(computerId);
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
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
    const computer = await this.get(computerId);
    if (computer.state === "deleted") throw new ComputerNotFound(computerId);
    if (!computer.providerRef) throw new DestroyProviderRefMismatch();
    if (input.providerRef !== computer.providerRef) {
      throw new DestroyProviderRefMismatch();
    }
    if (computer.state !== "deleting") {
      await this.transition(computerId, "deleting");
    }
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
    // Validate request at service boundary (schema-level enforcement)
    const validatedRequest = ExecRequestSchema.parse(request) as ExecRequest;

    const required: CapabilityScope[] =
      validatedRequest.mode === "shell" ? ["exec", "shell"] : ["exec"];
    const { computer } = this.authorize(auth, computerId, required);
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
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
    const validatedRequest = FsRequestSchema.parse(request) as FsRequest;
    const { computer } = this.authorize(auth, computerId, "fs");
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
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
    const { computer } = this.authorize(auth, computerId, "observe");
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
    const observation = await this.provider.observe(ref, request);
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
    const { computer } = this.authorize(auth, computerId, "act");
    const ref = this.requireProviderRef(computer);
    this.touch(computer);
    const actResult = await this.provider.act(ref, request);
    const failClosed = actResult.results.some(
      (row) => row.action.type === "click_element" && !row.success,
    );
    this.recordOperatorEvent({
      computerId: computer.id,
      birdId: computer.birdId,
      kind: failClosed ? "fail-closed" : "browser",
      operation: failClosed ? "click_element" : "act",
      success: actResult.ok && !failClosed,
      errorCode: failClosed ? "CLICK_ELEMENT_UNSUPPORTED" : null,
    });
    return actResult;
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
    const touched: ComputerCapability = {
      ...capability,
      scopes: copyScopes(capability.scopes),
      lastUsedAt: new Date(),
    };
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
    this.operatorEvents.push({
      id: newId(),
      at: new Date().toISOString(),
      computerId: input.computerId,
      birdId: input.birdId,
      kind: input.kind,
      operation: input.operation,
      success: input.success,
      errorCode: input.errorCode,
    });
    if (this.operatorEvents.length > OPERATOR_EVENT_CAP) {
      this.operatorEvents.splice(0, this.operatorEvents.length - OPERATOR_EVENT_CAP);
    }
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
