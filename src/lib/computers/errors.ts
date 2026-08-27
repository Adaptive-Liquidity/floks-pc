/**
 * Typed domain errors. Fail closed.
 */

export class ComputerError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class IllegalStateTransition extends ComputerError {
  constructor(from: string, to: string) {
    super(
      "ILLEGAL_STATE_TRANSITION",
      `Cannot transition computer from "${from}" to "${to}"`,
      { from, to },
    );
    this.name = "IllegalStateTransition";
  }
}

export class ComputerNotFound extends ComputerError {
  constructor(id: string) {
    super("COMPUTER_NOT_FOUND", `Computer not found: ${id}`, { id });
    this.name = "ComputerNotFound";
  }
}

export class CapabilityRevoked extends ComputerError {
  constructor(capabilityId?: string) {
    super("CAPABILITY_REVOKED", "Capability has been revoked or is invalid", {
      capabilityId,
    });
    this.name = "CapabilityRevoked";
  }
}

export class CapabilityExpired extends ComputerError {
  constructor(capabilityId?: string) {
    super("CAPABILITY_EXPIRED", "Capability has expired", { capabilityId });
    this.name = "CapabilityExpired";
  }
}

export class CapabilityInvalid extends ComputerError {
  constructor(reason: string) {
    super("CAPABILITY_INVALID", `Capability invalid: ${reason}`, { reason });
    this.name = "CapabilityInvalid";
  }
}

export class CapabilityMissing extends ComputerError {
  constructor(reason = "capability required") {
    super(
      "CAPABILITY_MISSING",
      `Computer operation requires a valid capability token; ${reason}`,
      { reason },
    );
    this.name = "CapabilityMissing";
  }
}

export class InsufficientScope extends ComputerError {
  constructor(required: string, have: readonly string[]) {
    super(
      "INSUFFICIENT_SCOPE",
      `Capability is missing required scope "${required}"`,
      { required, have: [...have] },
    );
    this.name = "InsufficientScope";
  }
}

export class InvalidScope extends ComputerError {
  constructor(scope: string) {
    super("INVALID_SCOPE", `Unknown capability scope: ${scope}`, { scope });
    this.name = "InvalidScope";
  }
}

export class CrossNodeDenied extends ComputerError {
  constructor(fromComputerId: string, toComputerId: string) {
    super(
      "CROSS_NODE_DENIED",
      "Capability is bound to a different computer/bird/flock",
      { fromComputerId, toComputerId },
    );
    this.name = "CrossNodeDenied";
  }
}

export class PairCodeInvalid extends ComputerError {
  constructor(reason: string) {
    super("PAIR_CODE_INVALID", `Pair code invalid: ${reason}`, { reason });
    this.name = "PairCodeInvalid";
  }
}

export class ProviderUnavailable extends ComputerError {
  constructor(provider: string, cause?: string) {
    super(
      "PROVIDER_UNAVAILABLE",
      `Provider "${provider}" unavailable${cause ? `: ${cause}` : ""}`,
      { provider, cause },
    );
    this.name = "ProviderUnavailable";
  }
}

export class PathEscape extends ComputerError {
  constructor(path: string) {
    super(
      "PATH_ESCAPE",
      `Path escapes allowed workspace root: ${path}`,
      { path },
    );
    this.name = "PathEscape";
  }
}

export class DuplicateComputer extends ComputerError {
  constructor(birdId: string) {
    super(
      "DUPLICATE_COMPUTER",
      `A computer already exists for bird_id ${birdId}`,
      { birdId },
    );
    this.name = "DuplicateComputer";
  }
}

export class QuotaExceeded extends ComputerError {
  constructor(resource: string) {
    super("QUOTA_EXCEEDED", `Quota exceeded for ${resource}`, { resource });
    this.name = "QuotaExceeded";
  }
}

export class BetaStoreRequired extends ComputerError {
  constructor() {
    super(
      "BETA_STORE_REQUIRED",
      "Private beta requires a durable control-plane store (in-memory is local/dev only)",
    );
    this.name = "BetaStoreRequired";
  }
}

export class BetaInviteRequired extends ComputerError {
  constructor(ownerId?: string) {
    super(
      "BETA_INVITE_REQUIRED",
      "Private beta requires an approved invite/waitlist for this owner",
      ownerId !== undefined ? { ownerId } : undefined,
    );
    this.name = "BetaInviteRequired";
  }
}

export class IdempotencyConflict extends ComputerError {
  constructor(key: string) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `Idempotency key already used with different payload: ${key}`,
      { key },
    );
    this.name = "IdempotencyConflict";
  }
}

export class DestroyConfirmRequired extends ComputerError {
  constructor() {
    super(
      "DESTROY_CONFIRM_REQUIRED",
      "Refusing to destroy: confirm must be true for the selected computer",
    );
    this.name = "DestroyConfirmRequired";
  }
}

export class DestroyProviderRefMismatch extends ComputerError {
  constructor() {
    super(
      "DESTROY_PROVIDER_REF_MISMATCH",
      "Refusing to destroy: providerRef does not match the selected computer",
    );
    this.name = "DestroyProviderRefMismatch";
  }
}

export class CheckpointRequired extends ComputerError {
  constructor() {
    super(
      "CHECKPOINT_REQUIRED",
      "Recovery requires a ready checkpoint; refusing to provision a blank replacement",
    );
    this.name = "CheckpointRequired";
  }
}

export class ObserveRetryable extends ComputerError {
  constructor(state: string) {
    super(
      "OBSERVE_RETRYABLE",
      `observe is not available while computer is ${state}; wake or recover first`,
      { state, retryable: true },
    );
    this.name = "ObserveRetryable";
  }
}

export class RestoreUnsupported extends ComputerError {
  constructor(provider: string) {
    super(
      "RESTORE_UNSUPPORTED",
      `${provider} does not restore checkpoints. L4 recovery uses provider-native snapshots (Runloop snapshotDisk / FakeProvider). DockerDev remains local isolation only.`,
      { provider },
    );
    this.name = "RestoreUnsupported";
  }
}

export class CleanupFailed extends ComputerError {
  constructor() {
    super(
      "CLEANUP_FAILED",
      "Destroy failed; computer is cleanup_needed. Retry with the captured providerRef only.",
    );
    this.name = "CleanupFailed";
  }
}
