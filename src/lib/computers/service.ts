/**
 * ComputerService — orchestration façade.
 * Routes and MCP tools call this; it is the only thing that talks to a ComputerProvider.
 * Phase 1 uses an in-memory Map; later phases replace the store with Kysely.
 */

import { randomBytes } from "node:crypto";
import type { ComputerProvider } from "./providers/provider.js";
import type {
  Computer,
  ComputerSpec,
  ComputerState,
} from "./types.js";
import {
  ComputerNotFound,
  DuplicateComputer,
  IllegalStateTransition,
} from "./errors.js";
import { assertTransition } from "./state.js";

function newId(): string {
  return randomBytes(16).toString("hex");
}

export class ComputerService {
  private computers = new Map<string, Computer>();
  private byBird = new Map<string, string>(); // birdId → computerId

  constructor(private readonly provider: ComputerProvider) {}

  /** Clear all in-memory state (test helper). */
  reset(): void {
    this.computers.clear();
    this.byBird.clear();
  }

  /**
   * Request a computer for a Node.
   * Enforces one-computer-per-birdId.
   * Calls provider.provision and records the resulting computer in state "ready".
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
    }
    return updated;
  }

  /** List all computers currently tracked (test / debug helper). */
  list(): Computer[] {
    return [...this.computers.values()];
  }
}

// Re-export the error so tests can import from one place if desired
export { IllegalStateTransition, DuplicateComputer, ComputerNotFound };
